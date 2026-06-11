import { AdminShell, DataTable, SectionHeader } from "../components";
import { adminLogs } from "../data";

export default function LogsPage() {
  return (
    <AdminShell>
      <SectionHeader title="操作日志" desc="所有管理员操作都必须记录到 admin_logs。" />
      <DataTable columns={["编号", "操作人", "动作", "对象", "时间"]} rows={adminLogs.map((log) => [log.id, log.actor, log.action, log.target, log.time])} />
    </AdminShell>
  );
}
