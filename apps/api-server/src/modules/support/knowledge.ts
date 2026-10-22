export type KnowledgeDoc = { id: string; title: string; content: string; keywords: string[] };
export type KnowledgeHit = { doc: KnowledgeDoc; score: number };

// Below this share of the query's terms covered by a document, the match is treated as noise.
export const MIN_KNOWLEDGE_SCORE = 0.3;
const MIN_KEYWORD_SCORE = 0.5;
const STOP_TERMS = new Set(["怎么", "什么", "吗", "呢", "可以", "我想", "请问", "一下", "这个", "那个", "你们", "我们", "是不", "不是", "有没", "没有"]);

/**
 * Chinese text has no spaces, so terms are character bigrams of each CJK run plus whole latin/number words.
 * For a knowledge base of tens to hundreds of entries this is accurate enough and needs no embedding service.
 */
export function knowledgeTerms(text: string): Set<string> {
  const normalized = text.normalize("NFKC").toLowerCase();
  const terms = new Set<string>();
  for (const word of normalized.match(/[a-z0-9]+/g) ?? []) if (word.length > 1 || /\d/.test(word)) terms.add(word);
  for (const run of normalized.match(/[一-鿿]+/g) ?? []) {
    if (run.length === 1) terms.add(run);
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!STOP_TERMS.has(bigram)) terms.add(bigram);
    }
  }
  return terms;
}

/**
 * Coverage (share of query terms found anywhere in the doc) decides whether a doc is relevant at all;
 * the weighted score, where keyword and title hits count extra, decides the order among relevant docs.
 */
export function retrieveKnowledge(query: string, docs: KnowledgeDoc[], limit = 3): KnowledgeHit[] {
  const queryTerms = knowledgeTerms(query);
  if (!queryTerms.size) return [];
  return docs
    .map(doc => {
      const body = knowledgeTerms(doc.content), title = knowledgeTerms(doc.title), keys = knowledgeTerms(doc.keywords.join(" "));
      let weight = 0, covered = 0;
      for (const term of queryTerms) {
        const w = keys.has(term) ? 2 : title.has(term) ? 1.5 : body.has(term) ? 1 : 0;
        weight += w;
        if (w) covered++;
      }
      return { doc, coverage: covered / queryTerms.size, score: weight / queryTerms.size };
    })
    // A single operator keyword hit is a strong signal even in a short question, hence the weighted floor.
    .filter(hit => hit.coverage >= MIN_KNOWLEDGE_SCORE || hit.score >= MIN_KEYWORD_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc, score }) => ({ doc, score }));
}

/** The model may only restate retrieved material; anything else must be handed to a person. */
export function groundedInstruction(hits: KnowledgeHit[]) {
  const material = hits.map((hit, i) => `【资料${i + 1}：${hit.doc.title}】${hit.doc.content}`).join("\n");
  return [
    "下面是平台知识库中与客户问题相关的资料。只能依据这些资料回答，不要补充资料里没有的规则、价格、时间或承诺。",
    "资料不足以回答时，直接说这一点需要人工客服确认，不要猜。",
    material
  ].join("\n");
}

/** Without a model, answer with the best document itself, trimmed to whole sentences. */
export function extractiveAnswer(hit: KnowledgeHit, maxChars = 160) {
  const sentences = hit.doc.content.match(/[^。！？!?]+[。！？!?]?/g) ?? [hit.doc.content];
  let answer = "";
  for (const sentence of sentences) {
    if (answer && answer.length + sentence.length > maxChars) break;
    answer += sentence;
  }
  return answer.trim();
}
