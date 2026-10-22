import { INestApplication } from "@nestjs/common";
import { ExpressAdapter } from "@nestjs/platform-express";
import { RECHARGE_JSON_MAX_BYTES } from "./modules/wallet/upload-evidence";

type Next = (error?: unknown) => void;
type Request = { method: string; path: string };
type Response = { status(code: number): { json(body: unknown): unknown } };

// Install before listen/init so the default parser does not reject supported images.
// The larger bounded parser is deliberately scoped to the image upload endpoints listed here.
const IMAGE_UPLOAD_ROUTES: Array<{ path: RegExp; tooLarge: string }> = [
  { path: /^\/api\/wallet\/recharge-requests\/?$/, tooLarge: "充值申请内容过大，请使用不超过2MiB的凭证图片并减少备注后重试，也可不附图片提交人工核对。" },
  { path: /^\/api\/orders\/[^/]+\/evidence\/?$/, tooLarge: "凭证内容过大，请使用不超过2MiB的截图并精简备注后重试。" }
];

export function configureRechargeBodyParser(app: INestApplication) {
  const uploadParser = new ExpressAdapter();
  uploadParser.useBodyParser("json", false, { limit: RECHARGE_JSON_MAX_BYTES, inflate: false });
  app.use((req: Request, res: Response, next: Next) => {
    const route = req.method === "POST" ? IMAGE_UPLOAD_ROUTES.find(r => r.path.test(req.path)) : undefined;
    if (!route) return next();
    uploadParser.getInstance()(req, res, (error?: { type?: string }) => {
      if (error?.type === "entity.too.large") {
        res.status(413).json({ statusCode: 413, message: route.tooLarge });
        return;
      }
      next(error);
    });
  });
}
