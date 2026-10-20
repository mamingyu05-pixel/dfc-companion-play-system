import { OrderReviewsService } from "../src/modules/orders/order-reviews.service";
import { prisma, orders, fixture } from "./acceptance-review.fixture";

const reviews = new OrderReviewsService(prisma);
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

test("7: only this order's customer can review after verified completion", async () => {
  const f = await fixture();
  for (const actor of [f.customer.id, f.companion.id, f.admin.id]) {
    await expect(reviews.create(f.order.id, actor, { stars: 5 })).rejects.toThrow();
  }
  await orders.acceptCompletion(f.order.id, f.customer.id);
  await expect(reviews.create(f.order.id, f.companion.id, { stars: 5 })).rejects.toThrow();
  await expect(reviews.create(f.order.id, f.admin.id, { stars: 5 })).rejects.toThrow();
  const another = await fixture("COMPLETED");
  await expect(reviews.create(f.order.id, another.customer.id, { stars: 5 })).rejects.toThrow();
  expect((await reviews.create(f.order.id, f.customer.id, { stars: 5 })).comment).toBe("");
});

test.each([undefined, null, 0, 6, 1.5, "5", true, NaN])("7: rejects invalid stars %s", async stars => {
  const f = await fixture("COMPLETED");
  await expect(reviews.create(f.order.id, f.customer.id, { stars })).rejects.toThrow();
});

test.each([1, 2, 3, 4, 5])("7: accepts integer stars %s and an optional empty comment", async stars => {
  const f = await fixture("COMPLETED");
  expect((await reviews.create(f.order.id, f.customer.id, { stars, comment: "" })).stars).toBe(stars);
});

test("7: accepts 200 Unicode characters; rejects 201 characters and non-text", async () => {
  const f = await fixture("COMPLETED");
  for (const comment of ["好".repeat(201), "😀".repeat(201), null, 123]) {
    await expect(reviews.create(f.order.id, f.customer.id, { stars: 4, comment })).rejects.toThrow();
  }
  expect((await reviews.create(f.order.id, f.customer.id, { stars: 4, comment: "😀".repeat(200) })).comment).toBe("😀".repeat(200));
});

test("7: concurrent submissions create one review; database independently enforces uniqueness and star bounds", async () => {
  const f = await fixture("COMPLETED");
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => reviews.create(f.order.id, f.customer.id, { stars: 3 })));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await prisma.orderReview.count({ where: { orderId: f.order.id } })).toBe(1);
  await expect(prisma.orderReview.create({ data: { orderId: f.order.id, stars: 5 } })).rejects.toThrow();
  const invalid = await fixture("COMPLETED");
  await expect(prisma.orderReview.create({ data: { orderId: invalid.order.id, stars: 6 } })).rejects.toThrow();
});

test("7: hidden review disappears from public text, average and count, remains visible to admin and cannot be re-reviewed", async () => {
  const f = await fixture("COMPLETED"), second = await fixture("COMPLETED");
  await prisma.order.update({ where: { id: second.order.id }, data: { companionId: f.companion.id } });
  const first = await reviews.create(f.order.id, f.customer.id, { stars: 1, comment: "hide-me" });
  const last = await reviews.create(second.order.id, second.customer.id, { stars: 5, comment: "visible" });
  const profile = async () => (await orders.listOrderableCompanions()).find(row => row.id === f.companion.id)!;
  expect(await profile()).toMatchObject({ averageRating: 3, reviewCount: 2 });
  await reviews.hide(first.id, f.admin.id);
  expect(await profile()).toMatchObject({ averageRating: 5, reviewCount: 1 });
  expect((await profile()).reviews.map(row => row.comment)).toEqual(["visible"]);
  expect((await reviews.list()).find(row => row.id === first.id)).toMatchObject({ hidden: true, comment: "hide-me" });
  expect((await orders.listCustomerOrders(f.customer.id))[0]).toMatchObject({ hasReview: true });
  expect(JSON.stringify(await orders.listCustomerOrders(f.customer.id))).not.toContain("hide-me");
  await expect(reviews.create(f.order.id, f.customer.id, { stars: 5 })).rejects.toThrow();
  await reviews.hide(last.id, f.admin.id);
  expect(await profile()).toMatchObject({ averageRating: null, reviewCount: 0, reviews: [] });
  expect(await prisma.adminLog.count({ where: { action: "HIDE_ORDER_REVIEW", entityId: first.id } })).toBe(1);
});
