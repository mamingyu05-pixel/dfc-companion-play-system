import { BadRequestException, Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UserRole } from "@prisma/client";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { extname, join } from "node:path";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

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

@Controller("uploads")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  @Post("companion-media")
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

    const relativeUrl = `/uploads/companions/${userSegment}/${filename}`;
    return {
      url: relativeUrl,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    };
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

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
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
