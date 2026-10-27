export type AdminUser = {
  id: string; email: string; role: string; status: string; displayName: string; createdAt: string;
  wallet: { availableBalance: string; frozenBalance: string; availableIncome: string; pendingIncome: string } | null;
  companionProfile: { nickname: string; status: string; onlineStatus: string; pricePerHour: string; kookPricePerHour?: string | null; discordPricePerHour?: string | null } | null;
  externalAccounts: Array<{ platform: string; externalUserId: string; displayName?: string | null }>;
};
export type UserStats = { customers: number; companions: number; admins: number; banned: number };
export type UserDirectory = { items: AdminUser[]; total: number; page: number; limit: number; stats: UserStats };
export type UserOptionPurpose = "balance-adjustment" | "companion-onboarding" | "password-reset" | "admin-promotion";
export type UserOptions = { items: AdminUser[]; hasMore: boolean; limit: number; purpose: UserOptionPurpose; selectedId: string | null };
export type UserLoadState<T> = { data: T | null; loading: boolean; error: string; path: string };
export const emptyUserLoadState = <T,>(): UserLoadState<T> => ({ data: null, loading: false, error: "", path: "" });
export const USER_PAGE_LIMIT = 50;
export const USER_OPTION_LIMIT = 25;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function validUser(value: unknown): value is AdminUser {
  if (!record(value) || !["id", "email", "role", "status", "displayName", "createdAt"].every(key => typeof value[key] === "string")) return false;
  if (value.wallet !== null && (!record(value.wallet) || !["availableBalance", "frozenBalance", "availableIncome", "pendingIncome"].every(key => typeof (value.wallet as Record<string, unknown>)[key] === "string"))) return false;
  if (value.companionProfile !== null && (!record(value.companionProfile) || typeof value.companionProfile.nickname !== "string" || typeof value.companionProfile.pricePerHour !== "string")) return false;
  return Array.isArray(value.externalAccounts) && value.externalAccounts.every(account => record(account) && typeof account.platform === "string" && typeof account.externalUserId === "string");
}
function boundedUsers(value: unknown, limit: number): value is AdminUser[] {
  return Array.isArray(value) && value.length <= limit && value.every(validUser) && new Set(value.map(user => user.id)).size === value.length;
}
export function userDirectoryPath(q: string, page: number) {
  const params = new URLSearchParams({ q: q.trim(), page: String(page), limit: String(USER_PAGE_LIMIT) });
  return "/api/admin/users/directory?" + params.toString();
}
export function userOptionsPath(purpose: UserOptionPurpose, q: string, selectedId: string) {
  const params = new URLSearchParams({ purpose, q: q.trim(), limit: String(USER_OPTION_LIMIT) });
  if (selectedId) params.set("selectedId", selectedId);
  return "/api/admin/users/options?" + params.toString();
}
export function decodeUserDirectory(value: unknown, page: number): UserDirectory {
  if (!record(value) || value.page !== page || value.limit !== USER_PAGE_LIMIT || !integer(value.total)
    || !boundedUsers(value.items, USER_PAGE_LIMIT) || value.items.length > value.total || !record(value.stats)
    || !["customers", "companions", "admins", "banned"].every(key => integer((value.stats as Record<string, unknown>)[key]))) throw Error("用户目录回执异常，请重新加载。");
  return value as UserDirectory;
}
export function decodeUserOptions(value: unknown, purpose: UserOptionPurpose, selectedId: string): UserOptions {
  if (!record(value) || value.purpose !== purpose || value.limit !== USER_OPTION_LIMIT || typeof value.hasMore !== "boolean"
    || !boundedUsers(value.items, USER_OPTION_LIMIT) || !(value.selectedId === null || value.selectedId === selectedId)
    || (typeof value.selectedId === "string" && !value.items.some(user => user.id === value.selectedId))) throw Error("候选账号回执异常，请重新搜索。");
  return value as UserOptions;
}
export function lastUserPage(total: number, limit = USER_PAGE_LIMIT) { return Math.max(1, Math.ceil(total / limit)); }

// One loader per directory/selector: cancellation saves work; the generation and token checks also reject late responses from clients that ignore AbortSignal.
export function createLatestUserLoader<T>({ fetcher, getToken, onChange }: {
  fetcher: typeof fetch; getToken: () => string | null; onChange: (state: UserLoadState<T>) => void;
}) {
  let generation = 0, controller: AbortController | null = null, state = emptyUserLoadState<T>(), disposed = false;
  const readToken = () => { try { return getToken(); } catch { return null; } };
  const publish = (next: UserLoadState<T>) => { state = next; if (!disposed) onChange({ ...state }); };
  return {
    async load(path: string, decode: (value: unknown) => T): Promise<T | null> {
      if (disposed) return null;
      const serial = ++generation;
      controller?.abort();
      controller = new AbortController();
      const token = readToken();
      if (!token) { publish({ data: null, loading: false, path, error: "请先核对管理员登录。" }); return null; }
      publish({ ...state, path, loading: true, error: "" });
      try {
        const response = await fetcher(path, { headers: { Authorization: "Bearer " + token }, signal: controller.signal });
        if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? "无法读取账号，请核对当前登录权限。" : "用户数据读取失败，请重试。");
        const data = decode(await response.json());
        if (disposed || serial !== generation) return null;
        if (readToken() !== token) { publish({ data: null, loading: false, path, error: "登录账号已变化，请重新加载用户数据。" }); return null; }
        publish({ data, path, loading: false, error: "" });
        return data;
      } catch (error) {
        if (disposed || serial !== generation) return null;
        if (readToken() !== token) publish({ data: null, loading: false, path, error: "登录账号已变化，请重新加载用户数据。" });
        else publish({ ...state, loading: false, error: error instanceof Error ? error.message : "用户数据读取失败，请重试。" });
        return null;
      }
    },
    dispose() { disposed = true; generation++; controller?.abort(); },
  };
}
