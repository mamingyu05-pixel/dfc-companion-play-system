import { KookAdapter } from "./index";

try {
  new KookAdapter();
  console.log("DFC KOOK adapter ready.");
  setInterval(() => undefined, 60_000);
} catch (error) {
  console.error(error);
  process.exit(1);
}
