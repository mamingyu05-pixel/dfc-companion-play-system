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
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { extname, join } from "node:path";
import { AuthenticatedUser, JwtPayload } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
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
  @UseGuards(JwtAuthGuard)
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
  uploadCompanionMedia(@CurrentUser() user: AuthenticatedUser, @Body() body: { purpose?: string }, @UploadedFile() file?: UploadedCompanionFile) {
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
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExtension(file.originalname, file.mimetype)}`;
    renameSync(file.path, join(targetDir, filename));

    const relativeUrl = `/api/uploads/companions/${userSegment}/${filename}`;
    return {
      url: relativeUrl,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    };
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

function safeExtension(originalName: string, mimeType: string) {
  const ext = extname(originalName).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "audio/webm") return ".webm";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "audio/wav") return ".wav";
  if (mimeType === "audio/mp4" || mimeType === "audio/x-m4a") return ".m4a";
  return ".mp3";
}
