import { BadRequestException } from "@nestjs/common";
import { KookWebhookController } from "../src/modules/kook/kook-webhook.controller";
import { KookOrderFlowService } from "../src/modules/kook/kook-order-flow.service";
import { DispatchVersionException } from "../src/modules/orders/dispatch-version";

function fixture() {
  const orders = { acceptOrderFromPlatform: jest.fn().mockResolvedValue({ status: "ACCEPTED" }) };
  const port = { wasIssuedTo: jest.fn().mockResolvedValue(false), wasIssuedInChannel: jest.fn().mockResolvedValue(false), send: jest.fn().mockResolvedValue({}) };
  const flows = new KookOrderFlowService({} as any, orders as any, {} as any, port);
  const notifications = { sendKookDirectMessage: jest.fn().mockResolvedValue({ status: "SENT" }) };
  const controller = new KookWebhookController(orders as any, {} as any, {} as any, notifications as any, {} as any, {} as any, {} as any, flows);
  const process = (value = "order.accept.order-1.0", eventId?: string, actor: string | undefined = "owner") =>
    (controller as any).processVerifiedWebhook({ d: { msg_id: eventId, author_id: "system-author", extra: {
      type: "message_btn_click", body: { user_id: actor, msg_id: "card-1", target_id: "channel-1", value }
    } } });
  return { orders, port, flows, notifications, process };
}

test("verified dispatch routing supports durable legacy events and independent clicks through flows", async () => {
  const f = fixture(), route = jest.spyOn(f.flows, "acceptVerifiedDispatch");
  for (const eventId of [undefined, "click-a", "click-b"]) {
    await expect(f.process(undefined, eventId)).resolves.toEqual({ status: "ACCEPTED" });
  }
  expect(route).toHaveBeenCalledTimes(3);
  expect(f.orders.acceptOrderFromPlatform).toHaveBeenCalledWith("KOOK", "order-1", "owner", "card-1", 0);
  expect(f.port.send).not.toHaveBeenCalled();
});

test("verified dispatch routing propagates actor rejection without a success receipt", async () => {
  const f = fixture();
  for (const reason of ["unbound", "other owner"]) {
    const error = new BadRequestException(reason);
    f.orders.acceptOrderFromPlatform.mockRejectedValueOnce(error);
    await expect(f.process()).rejects.toBe(error);
  }
  expect(f.notifications.sendKookDirectMessage).not.toHaveBeenCalled();
  expect(f.port.send).not.toHaveBeenCalled();
});

test("verified dispatch routing sends refresh feedback for malformed and stale versions", async () => {
  const f = fixture();
  for (const suffix of ["", "02", "2e0", "2.extra", "2\n", "-1", "9007199254740992"]) {
    await expect(f.process(`order.accept.order-1.${suffix}`)).resolves.toMatchObject({ rejected: true });
  }
  expect(f.orders.acceptOrderFromPlatform).not.toHaveBeenCalled();
  f.orders.acceptOrderFromPlatform.mockRejectedValueOnce(new DispatchVersionException());
  await expect(f.process()).resolves.toMatchObject({ rejected: true });
  expect(f.notifications.sendKookDirectMessage).toHaveBeenCalledTimes(8);
  expect(f.notifications.sendKookDirectMessage).toHaveBeenLastCalledWith("owner", expect.stringContaining("刷新订单"));
  f.notifications.sendKookDirectMessage.mockResolvedValueOnce({ status: "FAILED" });
  await expect(f.process("order.accept.order-1.02")).rejects.toThrow("DispatchRefreshPromptFailed");
});

test("private flow and issued legacy APIs retain issuance validation", async () => {
  const f = fixture();
  await f.process("dfc.order.accept.order-1.0.9999999999999", "click-a");
  expect(f.port.wasIssuedTo).toHaveBeenCalled();
  await f.flows.acceptLegacy({ userId: "owner", messageId: "card-1", eventId: "click-b", value: "order.accept.order-1.0" }, "channel-1");
  expect(f.port.wasIssuedInChannel).toHaveBeenCalledWith("channel-1", "card-1", "order.accept.order-1.0");
  expect(f.orders.acceptOrderFromPlatform).not.toHaveBeenCalled();
});

test("dispatch routing never substitutes the system author for a missing nested actor", async () => {
  const f = fixture();
  await expect(f.process(undefined, "click-a", "")).rejects.toThrow("Missing KOOK order accept payload");
  expect(f.orders.acceptOrderFromPlatform).not.toHaveBeenCalled();
});
