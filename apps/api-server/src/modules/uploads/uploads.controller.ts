import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UnauthorizedException
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { FileInterceptor } from "@nestjs/platform-express";
import { CompanionProfileStatus, UserRole, UserStatus } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { extname, join } from "node:path";
import { AuthenticatedUser, JwtPayload } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthRateLimitGuard } from "../auth/auth-rate-limit.guard";
import { PrismaService } from "../prisma/prisma.service";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a"]);
const ALLOWED_PURPOSES = new Set(["avatar", "photo", "voice", "payoutQr"]);
const TMP_UPLOAD_DIR = join(getUploadRoot(), "tmp");
ensureDir(TMP_UPLOAD_DIR);

type UploadedCompanionFile = {
  originalname: string;
  mimetype: string;
  size: number;
  filename: string;
  path: string;
};

type SendFileResponse = {
  sendFile(path: string): void;
  setHeader(name: string, value: string): void;
};

type UploadRequest = {
  header(name: string): string | undefined;
};

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  @Post("companion-media")
  @UseGuards(JwtAuthGuard, AuthRateLimitGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      dest: TMP_UPLOAD_DIR,
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (req, file, callback) => {
        const purpose = String((req.body as { purpose?: string }).purpose ?? "");
        const isVoice = purpose === "voice";
        const allowed = isVoice ? AUDIO_MIME_TYPES.has(file.mimetype) : IMAGE_MIME_TYPES.has(file.mimetype);
        callback(allowed ? null : new BadRequestException(isVoice ? "Only audio files are allowed" : "Only image files are allowed"), allowed);
      }
    })
  )
  async uploadCompanionMedia(@CurrentUser() user: AuthenticatedUser, @Body() body: { purpose?: string }, @UploadedFile() file?: UploadedCompanionFile) {
    try {
    if (!ALLOWED_PURPOSES.has(String(body.purpose ?? ""))) {
      throw new BadRequestException("Invalid upload purpose");
    }
    if (!file) {
      throw new BadRequestException("file is required");
    }
    if (!canUploadCompanionMedia(user.role)) {
      throw new BadRequestException("Only logged-in users can upload companion media");
    }

    const userSegment = safeSegment(user.id);
    const targetDir = join(getUploadRoot(), "companions", userSegment);
    ensureDir(targetDir);
    const input = readFileSync(file.path);
    const media = await normalizeMedia(input, file.originalname, file.mimetype, body.purpose === "voice");
    const filename = `${randomUUID()}${media.extension}`;
    writeFileSync(join(targetDir, filename), media.bytes, { flag: "wx" });

    const relativeUrl = `/api/uploads/companions/${userSegment}/${filename}`;
    return {
      url: relativeUrl,
      originalName: file.originalname,
      mimeType: media.mimeType,
      size: media.bytes.length
    };
    } finally {
      if (file?.path && existsSync(file.path)) unlinkSync(file.path);
    }
  }

  @Get("companions/:userId/:filename")
  async getCompanionMedia(
    @Req() request: UploadRequest,
    @Param("userId") userId: string,
    @Param("filename") filename: string,
    @Res() res: SendFileResponse
  ) {
    const userSegment = safeSegment(userId);
    if (userSegment !== userId || !isSafeFilename(filename)) {
      throw new BadRequestException("Invalid upload path");
    }

    const filePath = join(getUploadRoot(), "companions", userSegment, filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException("Upload not found");
    }

    // Also constrain legacy files: extension/MIME alone can never enable HTML.
    const mediaType = SAFE_MEDIA_TYPES[extname(filename).toLowerCase()];
    if (!mediaType) throw new NotFoundException("Unsupported media format");
    res.setHeader("Content-Type", mediaType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; media-src 'self'; img-src 'self'; base-uri 'none'");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");

    if (await this.isPublicCompanionMedia(userSegment, filename)) {
      res.sendFile(filePath);
      return;
    }

    const user = await this.getAuthenticatedUser(request);
    if (!canReadCompanionMedia(user, userSegment)) {
      throw new ForbiddenException("You cannot access this upload");
    }
    res.sendFile(filePath);
  }

  private async isPublicCompanionMedia(userSegment: string, filename: string) {
    const urls = [`/api/uploads/companions/${userSegment}/${filename}`, `/uploads/companions/${userSegment}/${filename}`];
    const profile = await this.prisma.companionProfile.findFirst({
      where: {
        userId: userSegment,
        status: CompanionProfileStatus.LISTED,
        OR: [
          { avatarUrl: { in: urls } },
          { voiceIntroUrl: { in: urls } },
          { photoUrls: { has: urls[0] } },
          { photoUrls: { has: urls[1] } }
        ]
      },
      select: { id: true }
    });
    return Boolean(profile);
  }

  private async getAuthenticatedUser(request: UploadRequest): Promise<AuthenticatedUser> {
    const authHeader = request.header("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException("JWT_SECRET is not configured");
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException("Invalid token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true }
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User is not active");
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}

function getUploadRoot() {
  return process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function canUploadCompanionMedia(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN || role === UserRole.COMPANION || role === UserRole.CUSTOMER;
}

function canReadCompanionMedia(user: AuthenticatedUser, userSegment: string) {
  return safeSegment(user.id) === userSegment || user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isSafeFilename(value: string) {
  return /^[a-zA-Z0-9_.-]+$/.test(value) && !value.includes("..");
}

const SAFE_MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4"
};

export async function normalizeMedia(bytes: Buffer, originalName: string, declaredType: string, voice: boolean) {
  const extension = extname(originalName).toLowerCase();
  const declared = declaredType === "audio/mp3" ? "audio/mpeg" : declaredType === "audio/x-m4a" ? "audio/mp4" : declaredType;
  if (SAFE_MEDIA_TYPES[extension] !== declared) throw new BadRequestException("File extension does not match its media type");
  if (!voice) {
    try {
      const decoded = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" });
      const metadata = await decoded.metadata();
      const expected = declared.replace("image/", "");
      if (!["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "") || metadata.format !== expected) throw new Error("Invalid image format");
      const output = await decoded.rotate().png().toBuffer();
      return { bytes: output, extension: ".png", mimeType: "image/png" };
    } catch {
      throw new BadRequestException("Invalid or oversized image");
    }
  }
  const signature = bytes.subarray(0, 12);
  const valid =
    (declared === "audio/wav" && signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "WAVE") ||
    (declared === "audio/ogg" && signature.toString("ascii", 0, 4) === "OggS") ||
    (declared === "audio/webm" && signature.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) ||
    (declared === "audio/mp4" && signature.toString("ascii", 4, 8) === "ftyp") ||
    (declared === "audio/mpeg" && (signature.toString("ascii", 0, 3) === "ID3" || (signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0)));
  if (!valid) throw new BadRequestException("Audio signature does not match its media type");
  return { bytes, extension: declared === "audio/mp4" ? ".m4a" : extension, mimeType: declared };
}
