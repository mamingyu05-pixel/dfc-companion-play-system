import { ArgumentsHost, Catch, HttpException, InternalServerErrorException, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { toChineseError } from "./error-messages";

const translate = (value: unknown) => (typeof value === "string" ? toChineseError(value) : value);

/** Every HTTP error leaves the API in Chinese; unexpected errors are still logged in full. */
@Catch()
export class ChineseErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger("ExceptionsHandler");

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== "http") return super.catch(exception, host);
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const response = typeof body === "string"
        ? { statusCode: status, message: toChineseError(body) }
        : { ...(body as Record<string, unknown>), message: Array.isArray((body as { message?: unknown }).message)
            ? ((body as { message: unknown[] }).message).map(translate)
            : translate((body as { message?: unknown }).message) };
      return super.catch(new HttpException(response, status, { cause: exception }), host);
    }
    this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    return super.catch(new InternalServerErrorException(toChineseError("Internal server error")), host);
  }
}
