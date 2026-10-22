CREATE TABLE "support_knowledge" (
  "id" TEXT NOT NULL,
  "title" VARCHAR(80) NOT NULL,
  "content" VARCHAR(1200) NOT NULL,
  "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "support_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_knowledge_isActive_idx" ON "support_knowledge"("isActive");

-- Starter answers describe only behaviour the system enforces; operators edit them in admin.
INSERT INTO "support_knowledge" ("id", "title", "content", "keywords", "updatedAt") VALUES
('kb-escrow', '资金托管：钱什么时候给陪玩', '下单时只从你的钱包余额冻结订单金额，陪玩接单、服务期间都拿不到这笔钱。陪玩报完成后，由你确认验收；你不操作的话，到期（默认 48 小时）且没有未处理投诉才会自动验收。验收后才结算给陪玩。验收前有异议可以提交投诉，资金继续冻结，由客服核对后裁决退回或结算。', ARRAY['托管','冻结','验收','结算','安全','跑路','先付款'], CURRENT_TIMESTAMP),
('kb-guarantee', '保底护航怎么算', '保底护航按仓库净增结果收费：开局前上传一张仓库总价值截图，打完后上传结束仓库截图，净增达到所选档位（如 400W、688W、1288W）陪玩才能报完成。没达标不会结算给陪玩，可以继续服务，或在验收前提交投诉由客服裁决退回或结算。档位价格以下单页为准。', ARRAY['保底','护航','哈夫币','净增','炸单','仓库','档位','没达标','没打到','没达到','打不到'], CURRENT_TIMESTAMP),
('kb-guarantee-rules', '护航规则与封号风险', '平台只做纯手动护航：不交号、不转移物资、不代充三角币、不买卖哈夫币。开局后请不要出售或转移仓库物资，否则净增无法核对。正常对局仍有风险，平台不承诺零封号。', ARRAY['封号','安全','交号','转移','代充','绿玩','外挂'], CURRENT_TIMESTAMP),
('kb-order', '怎么下单', '登录客户端后，在下单页选陪玩、模式和时长，点「核对订单金额」看服务端报价，确认后从余额冻结金额并创建订单。想按结果收费可以选「保底护航」。下完单可以在「我的订单」看进度、验收和评价，已完成的订单可以一键再来一单。', ARRAY['下单','怎么点','预约','点单','流程','再来一单'], CURRENT_TIMESTAMP),
('kb-price', '价格怎么定', '小时陪玩按游戏、段位档位和陪玩不同定价，以下单页核对的金额为准；多点几位陪玩可能有每小时减免。保底护航按档位一口价。价格随时可能调整，已下的单按下单时的价格结算。', ARRAY['价格','多少钱','收费','报价','单价','贵'], CURRENT_TIMESTAMP),
('kb-recharge', '充值和到账', '目前是人工充值：在充值页提交金额和付款截图，管理员核对后入账，审核期间余额不会增加。使用优惠码满足条件会额外赠送。已付款但长时间未到账，请在充值记录里查看审核状态，或联系人工客服核对。', ARRAY['充值','到账','余额','优惠码','付款','转账'], CURRENT_TIMESTAMP),
('kb-refund', '退款和投诉', '对服务有异议，请在验收前通过「服务异议 / 投诉与申诉」提交，说明问题并附上截图或录屏。投诉处理期间订单资金继续冻结，由客服核对后决定全额退回、部分退回或正常结算，退回金额进入站内余额。AI 客服不能直接办理退款。', ARRAY['退款','投诉','不满意','退钱','申诉','售后','纠纷'], CURRENT_TIMESTAMP),
('kb-trial', '试音和选陪玩', '可以先试音再决定：在客服频道说明游戏、模式和想要的风格，客服会安排候选陪玩试音，试音只确认沟通体验，不算订单开始。确定人选后再正式下单。', ARRAY['试音','选人','声音','候选','挑陪玩'], CURRENT_TIMESTAMP),
('kb-companion-join', '怎么成为陪玩', '想成为陪玩，需要先联系人工客服提交资料和试音考核，通过后由管理员创建并上架陪玩账号。上架后可以在陪玩端接单、查看收益和申请提现，提现由管理员审核后人工打款。', ARRAY['入驻','应聘','接单','当陪玩','招募','提现'], CURRENT_TIMESTAMP),
('kb-acceptance', '自动验收', '陪玩报完成后，客户可以手动确认验收。如果一直不处理，默认 48 小时后系统自动验收；但只要有未处理的投诉，就不会自动验收。', ARRAY['自动验收','多久','确认','完成'], CURRENT_TIMESTAMP),
('kb-platforms', 'KOOK / Discord 下单', '也可以在 KOOK 或 Discord 的客服频道直接说需求，AI 客服会整理成需求发到派单频道，陪玩报名后由你或客服选人。首次在 KOOK 使用需要私聊发送「首次使用」建立客户档案，已有网页账号的请先绑定。', ARRAY['kook','discord','群','频道','私聊','绑定'], CURRENT_TIMESTAMP);
