import { publicGameLabel, publicServiceLabel } from "../src/modules/orders/public-dispatch";

test("public dispatch shows standard modes but never free text from a customer", () => {
  expect(publicServiceLabel("CUSTOM", "烽火地带")).toBe("烽火地带");
  expect(publicServiceLabel("RANKED", " 排位上分 ")).toBe("排位上分");
  expect(publicServiceLabel("CUSTOM", "加我微信 abc123，私下交易")).toBe("定制服务（详情联系授权客服）");
  expect(publicServiceLabel("ENTERTAINMENT", null)).toBe("娱乐陪玩");
  expect(publicGameLabel("DELTA_FORCE")).toBe("三角洲行动");
  expect(publicGameLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
});
