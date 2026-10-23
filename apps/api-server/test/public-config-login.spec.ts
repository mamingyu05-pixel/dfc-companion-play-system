import { AuthService } from "../src/modules/auth/auth.service";

const KEYS = ["KOOK_CLIENT_ID", "KOOK_CLIENT_SECRET", "KOOK_REDIRECT_URI", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI"];
afterEach(() => { for (const key of KEYS) delete process.env[key]; });

// getPublicConfig reads only the environment, so the service can be built without its collaborators.
const auth = Object.create(AuthService.prototype) as AuthService;

test("login pages offer KOOK one-click login only when the KOOK OAuth app is fully configured", () => {
  expect(auth.getPublicConfig().login).toEqual({ kook: false, discord: false });
  process.env.KOOK_CLIENT_ID = "id";
  process.env.KOOK_CLIENT_SECRET = "secret";
  expect(auth.getPublicConfig().login.kook).toBe(false);
  process.env.KOOK_REDIRECT_URI = "http://example.invalid/api/auth/oauth/kook/callback";
  expect(auth.getPublicConfig().login).toEqual({ kook: true, discord: false });
});
