import { test } from "node:test";
import assert from "node:assert/strict";
import {
  turnDetails,
  buildMessages,
  copySeat,
  defaultSettings,
  formatAsOf,
  sortModels,
  formatCost,
  formatDate,
  stripSelfPrefix,
  systemPromptFor,
  thinkingChoices,
  friendlySeatName,
  uniqueSeatName,
  seatColorFor,
  addressedSeat,
  addresseeLabel,
  DEFAULT_HOUSE_RULES,
  readAddress,
  privateLabel,
  privateWithFor,
  privateGroup,
  canSee,
  editDistance,
  teamCall,
  upgradeHouseRules,
  turnSpeed,
  speedLabel,
  waitingLabel,
  speedDetails,
  describeAttachment,
  formatBytes,
  hasFileParts,
  totalCost,
  splitFiles,
  cleanFileName,
  madeKind,
  describeMadeFile,
  MAKING_FILES_NOTE,
  replacedFiles,
  isSettled,
} from "../src/engine";
import type { Entry, MadeFile, Seat, Settings } from "../src/types";

function setup() {
  const settings: Settings = defaultSettings();
  settings.humanName = "Bill";
  settings.seats = [
    { id: "A", name: "Claude", model: "anthropic/claude-opus-5.5", role: "Be brief.", effort: "default", color: "#c96442" },
    { id: "B", name: "Grok", model: "x-ai/grok-4.7", role: "", effort: "high", color: "#6b7280" },
    { id: "C", name: "Gemini", model: "~google/gemini-pro-latest", role: "", effort: "default", color: "#4285f4" },
  ];
  return settings;
}

let n = 0;
const T = "2026-10-06T23:00:00.000Z";
const human = (text: string, privateWith?: string): Entry => ({ id: `e${n++}`, speaker: "human", speakerName: "Bill", text, time: T, privateWith });
const bot = (seat: Seat, text: string, extra: Partial<Entry> = {}): Entry => ({
  id: `e${n++}`, speaker: seat.id, speakerName: seat.name, text, time: T, status: "done", model: seat.model, ...extra,
});

test("each seat sees others as labeled user messages and itself as assistant", () => {
  const s = setup();
  const [A, B, C] = s.seats as [Seat, Seat, Seat];
  const entries = [human("What is time?"), bot(A, "A view."), bot(B, "B view."), bot(C, "C view.")];
  const m = buildMessages(A, s, entries);
  assert.equal(m[0]?.role, "system");
  assert.deepEqual(
    m.slice(1).map((x) => x.role),
    ["user", "assistant", "user"],
  );
  assert.equal(m[1]?.content, "Bill says:\nWhat is time?");
  assert.equal(m[2]?.content, "A view.");
  assert.equal(m[3]?.content, "Grok says:\nB view.\n\nGemini says:\nC view."); // merged into one user turn
});

test("private exchanges are visible only to their seat", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const entries = [
    human("Hello all."),
    human("Grok, be contrarian.", "B"),
    bot(B, "Understood.", { privateWith: "B" }),
    bot(B, "I disagree with everything."),
  ];
  const forA = buildMessages(A, s, entries).map((x) => x.content).join("\n");
  assert.ok(!forA.includes("contrarian"));
  assert.ok(!forA.includes("Understood."));
  assert.ok(forA.includes("Grok says:\nI disagree with everything."));

  const forB = buildMessages(B, s, entries);
  assert.ok(forB[1]?.content.includes("Bill says (privately, only you can see this):\nGrok, be contrarian."));
  assert.equal(forB[2]?.role, "assistant");
  assert.equal(forB[2]?.content, "Understood.\n\nI disagree with everything."); // consecutive own turns merged
  assert.equal(forB.at(-1)?.role, "user"); // nudge added because it last spoke itself
  assert.match(forB.at(-1)?.content ?? "", /asks you to continue/);
});

test("empty conversation gets an opener; a seat opening first gets one prepended", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const m0 = buildMessages(A, s, []);
  assert.equal(m0.length, 2);
  assert.match(m0[1]?.content ?? "", /open the conversation/);

  const m1 = buildMessages(A, s, [bot(A, "I'll start.")]);
  assert.deepEqual(m1.slice(1).map((x) => x.role), ["user", "assistant", "user"]);

  const m2 = buildMessages(B, s, [bot(A, "I'll start.")]);
  assert.deepEqual(m2.slice(1).map((x) => x.role), ["user"]);
  assert.equal(m2[1]?.content, "Claude says:\nI'll start.");
});

test("failed and still-arriving replies are never shown; stopped ones are", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const entries = [
    human("Q"),
    bot(B, "partial answer", { status: "error", error: "boom" }),
    bot(B, "", { status: "streaming" }),
    bot(B, "cut short", { status: "stopped" }),
  ];
  const text = buildMessages(A, s, entries).map((x) => x.content).join("\n");
  assert.ok(!text.includes("partial answer"));
  assert.ok(text.includes("Grok says:\ncut short"));
});

test("system prompt lists participants, marks 'you', appends the role, fills the date", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const p = systemPromptFor(A, s, new Date(2026, 9, 6, 23, 5));
  assert.ok(p.startsWith("You are Claude,"));
  assert.ok(p.includes("- Bill (human moderator)"));
  assert.ok(p.includes("- Claude: model anthropic/claude-opus-5.5 (this is you)"));
  assert.ok(p.includes("- Grok: model x-ai/grok-4.7\n"));
  assert.ok(p.includes("Today's date is 2026 Oct 06."));
  assert.ok(p.endsWith("Your role in this conversation:\nBe brief."));
  assert.ok(!p.includes("{"), "no unfilled placeholders");
});

test("stripSelfPrefix removes only the seat's own label", () => {
  assert.equal(stripSelfPrefix("Claude says: Hi there", "Claude"), "Hi there");
  assert.equal(stripSelfPrefix("**Claude says:** Hi", "Claude"), "Hi");
  assert.equal(stripSelfPrefix("Claude:\nHi", "Claude"), "Hi");
  assert.equal(stripSelfPrefix("Claudette: Hi", "Claude"), "Claudette: Hi");
  assert.equal(stripSelfPrefix("Grok says: Hi", "Claude"), "Grok says: Hi");
  assert.equal(stripSelfPrefix("C++ (bot) says: x", "C++ (bot)"), "x");
  assert.equal(stripSelfPrefix("I think Claude says: yes", "Claude"), "I think Claude says: yes");
});

test("copies get unique names and the same model", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const c1 = copySeat(A, s.seats);
  assert.equal(c1.name, "Claude 2");
  assert.equal(c1.model, A.model);
  assert.notEqual(c1.id, A.id);
  assert.equal(c1.role, "");
  const c2 = copySeat(c1, [...s.seats, c1]);
  assert.equal(c2.name, "Claude 3");
});

test("formatting helpers", () => {
  assert.equal(formatDate(new Date(2026, 9, 6)), "2026 Oct 06");
  assert.equal(formatCost(0.0213), "$0.0213");
  assert.equal(formatCost(1.2749), "$1.27");
  assert.equal(formatCost(0), "$0.00");
});

test("formatAsOf: the time alone today, the date and time on another day", () => {
  const now = new Date(2026, 9, 17, 15, 28);
  assert.equal(formatAsOf(new Date(2026, 9, 17, 9, 1), now), "09:01 today");
  assert.equal(formatAsOf(new Date(2026, 9, 14, 9, 1), now), "2026 Oct 14 at 09:01");
  assert.equal(formatAsOf(new Date(2025, 9, 17, 9, 1), now), "2025 Oct 17 at 09:01", "the same day a year earlier isn't today");
});

test("thinking menu mirrors the model's own levels, default marked", () => {
  const base = { id: "m", name: "M", inputPrice: 1, outputPrice: 1, contextLength: 1 };
  assert.deepEqual(thinkingChoices(undefined), [{ value: "default", label: "model’s default" }]);
  assert.deepEqual(thinkingChoices(base), [{ value: "default", label: "not adjustable" }]);
  assert.deepEqual(
    thinkingChoices({ ...base, reasoning: { efforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", mandatory: true } }),
    [
      { value: "max", label: "max" },
      { value: "xhigh", label: "xhigh" },
      { value: "default", label: "high (default)" },
      { value: "medium", label: "medium" },
      { value: "low", label: "low" },
    ],
  );
  // Optional thinking that is off unless asked for.
  assert.deepEqual(
    thinkingChoices({ ...base, reasoning: { efforts: ["high", "low", "none"], mandatory: false, defaultEnabled: false } }),
    [
      { value: "high", label: "high" },
      { value: "low", label: "low" },
      { value: "default", label: "none (default)" },
    ],
  );
  // Levels listed but no default named.
  assert.deepEqual(
    thinkingChoices({ ...base, reasoning: { efforts: ["high", "low"], mandatory: true } }).map((c) => c.value),
    ["default", "high", "low"],
  );
});

// ---------------------------------------------------------------------------
// About-you, thinking levels in the export, attachments

const opusInfo = {
  id: "anthropic/claude-opus-5.5", name: "Opus", inputPrice: 4, outputPrice: 20, contextLength: 1, inputModalities: ["text", "image", "file"],
  reasoning: { efforts: ["max", "xhigh", "high", "medium", "low"], defaultEffort: "high", mandatory: true },
};
const grokInfo = {
  id: "x-ai/grok-4.7", name: "Grok", inputPrice: 2, outputPrice: 6, contextLength: 1, inputModalities: ["text", "image"],
  reasoning: { efforts: ["xhigh", "high", "medium", "low"], defaultEffort: "high", mandatory: true },
};

test("About-you text goes to every seat, before its role", () => {
  const s = setup();
  s.aboutHuman = "Retired engineer; likes astronomy.";
  const [A, B] = s.seats as [Seat, Seat];
  const pa = systemPromptFor(A, s);
  assert.ok(pa.includes("About Bill, in Bill's own words:\nRetired engineer; likes astronomy."));
  assert.ok(pa.indexOf("About Bill") < pa.indexOf("Your role in this conversation"));
  assert.ok(systemPromptFor(B, s).includes("Retired engineer"));
  s.aboutHuman = "   ";
  assert.ok(!systemPromptFor(A, s).includes("About Bill"));
});

const textFile = { id: "f1", name: "notes.md", kind: "text" as const, mime: "text/markdown", size: 20, tokens: 5, data: "# Notes\nTime is a river." };
const image = { id: "f2", name: "orbit.png", kind: "image" as const, mime: "image/png", size: 100, data: "data:image/png;base64,AAAA" };
const pdf = { id: "f3", name: "paper.pdf", kind: "pdf" as const, mime: "application/pdf", size: 900, data: "data:application/pdf;base64,JVBERi0=" };

test("attachments: text inline, images and PDFs as parts, merged into one user turn", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const entries = [human("Please read these."), { ...human("See attached."), attachments: [textFile, image, pdf] }];
  const m = buildMessages(A, s, entries);
  assert.equal(m.length, 2);
  const parts = m[1]?.content;
  assert.ok(Array.isArray(parts));
  assert.deepEqual(parts.map((p) => p.type), ["text", "image_url", "text", "file"]);
  const first = parts[0] as { text: string };
  assert.ok(first.text.startsWith("Bill says:\nPlease read these.\n\nBill says:\nSee attached."));
  assert.ok(first.text.includes('<file name="notes.md">\n# Notes\nTime is a river.\n</file>'));
  assert.ok(first.text.endsWith("(Attached image: orbit.png)"));
  assert.deepEqual(parts[1], { type: "image_url", image_url: { url: image.data } });
  assert.deepEqual(parts[3], { type: "file", file: { filename: "paper.pdf", file_data: pdf.data } });
  assert.equal(hasFileParts(m), true);
});

test("attachments: text-only models are told about images; missing files are noted; files-only entries", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const entries = [{ ...human(""), attachments: [image, { ...textFile, data: undefined }] }];
  const m = buildMessages(A, s, entries, new Date(), { images: false });
  assert.equal(typeof m[1]?.content, "string", "no image part: plain text message");
  const text = m[1]?.content as string;
  assert.ok(text.startsWith("Bill shares these files:"));
  assert.ok(text.includes("(Bill attached an image, orbit.png, but your model can't view images.)"));
  assert.ok(text.includes("(Bill attached notes.md, but the file is no longer available.)"));
  assert.equal(hasFileParts(m), false);
});

test("attachments: models that can't take PDFs are told one was shared", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const m = buildMessages(A, s, [{ ...human("Have a look."), attachments: [pdf] }], new Date(), { images: true, pdfs: false });
  assert.equal(typeof m[1]?.content, "string");
  assert.ok((m[1]?.content as string).endsWith("(Bill attached a PDF, paper.pdf, but your model can't read PDFs.)"));
  assert.equal(hasFileParts(m), false);
});

test("attachments in private messages stay private", () => {
  const s = setup();
  const [A, B] = s.seats as [Seat, Seat];
  const entries = [{ ...human("Only for Grok", "B"), attachments: [textFile] }];
  assert.ok(!JSON.stringify(buildMessages(A, s, entries)).includes("Time is a river"));
  assert.ok(JSON.stringify(buildMessages(B, s, entries)).includes("Time is a river"));
});

test("describeAttachment and formatBytes", () => {
  assert.equal(formatBytes(820), "820 bytes");
  assert.equal(formatBytes(12 * 1024), "12 KB");
  assert.equal(formatBytes(1.4 * 1024 * 1024), "1.4 MB");
  assert.equal(describeAttachment(pdf), "paper.pdf (PDF, 900 bytes)");
  assert.equal(describeAttachment({ ...textFile, tokens: 3000 }), "notes.md (text, 20 bytes, about 3,000 tokens)");
});

test("tokens per second: overall, and visible text once it starts", () => {
  const s = setup();
  const [A] = s.seats as [Seat];
  const usage = { promptTokens: 600, completionTokens: 1480, reasoningTokens: 1310, cachedTokens: 0, cacheWriteTokens: 0 };
  const e = bot(A, "x", { usage, timing: { totalMs: 21300, firstTextMs: 15800 } });
  const sp = turnSpeed(e)!;
  assert.equal(speedLabel(sp), "69 tokens/s");
  assert.equal(Math.round(sp.visibleTokensPerSecond!), 31);
  assert.equal(
    speedDetails(e, sp),
    "1,480 tokens written (1,310 of them thinking) in 21.3 s from pressing Speak to the last word: 69 tokens per second overall. " +
      "The first words appeared after 15.8 s; after that, text arrived at about 31 tokens per second.",
  );
  // Too little streaming time to judge the visible rate; no usage or no timing: no speed at all.
  assert.equal(turnSpeed(bot(A, "x", { usage, timing: { totalMs: 16000, firstTextMs: 15800 } }))!.visibleTokensPerSecond, undefined);
  assert.equal(turnSpeed(bot(A, "x", { timing: { totalMs: 1000 } })), undefined);
  assert.equal(turnSpeed(bot(A, "x", { usage })), undefined);
});

test("waiting for a reply: the time waited from the first second on, in minutes past a minute", () => {
  assert.equal(waitingLabel("Grok", 400), "waiting for Grok…");
  assert.equal(waitingLabel("Grok", 1000), "waiting for Grok… 1 s");
  assert.equal(waitingLabel("Grok", 59_900), "waiting for Grok… 59 s");
  assert.equal(waitingLabel("Grok", 65_000), "waiting for Grok… 1 min 5 s");
});

test("default house rules: Bill's guidance included; untouched old copies upgraded, edited ones kept", () => {
  assert.ok(DEFAULT_HOUSE_RULES.includes("Avoid even a hint of sycophancy, toward {humanName} or toward the other participants."));
  assert.ok(DEFAULT_HOUSE_RULES.endsWith("No answer, or a qualified one, is better than a confident mistake."));
  const old = DEFAULT_HOUSE_RULES.slice(0, DEFAULT_HOUSE_RULES.indexOf("\n\nHow to contribute:"));
  assert.ok(old.endsWith("- Today's date is {date}."));
  assert.equal(upgradeHouseRules(old), DEFAULT_HOUSE_RULES);
  assert.equal(upgradeHouseRules(old + "\n"), DEFAULT_HOUSE_RULES, "trailing whitespace doesn't matter");
  const edited = old + "\n- Always answer in Latin.";
  assert.equal(upgradeHouseRules(edited), edited);
  assert.equal(upgradeHouseRules(DEFAULT_HOUSE_RULES), DEFAULT_HOUSE_RULES);
  // The confidence rule as revised on 2026 Oct 09.
  const newRule = 'say what would raise or lower it. Don\'t say 100% or 0% without clear, hard evidence.';
  const oldRule = "say what would raise it. Don't say 100% without clear, hard evidence.";
  assert.ok(DEFAULT_HOUSE_RULES.includes(newRule));
  assert.ok(!DEFAULT_HOUSE_RULES.includes(oldRule));
  const oct07 = DEFAULT_HOUSE_RULES.replace(newRule, oldRule);
  assert.equal(upgradeHouseRules(oct07), DEFAULT_HOUSE_RULES, "the untouched Oct 07 default is upgraded");
  const editedOct07 = oct07.replace("Keep each contribution focused", "Keep each contribution short");
  const upgraded = upgradeHouseRules(editedOct07);
  assert.ok(upgraded.includes(newRule) && !upgraded.includes(oldRule), "an edited copy gets just the new confidence rule");
  assert.ok(upgraded.includes("Keep each contribution short"), "and keeps the edits");
  // Every placeholder in the default is filled.
  const s = setup();
  const p = systemPromptFor(s.seats[0] as Seat, s);
  assert.ok(!/\{(name|humanName|participants|date)\}/.test(p));
  assert.ok(p.includes("Avoid even a hint of sycophancy, toward Bill or toward the other participants."));
});

test("first run: no seats, a placeholder name", () => {
  const d = defaultSettings();
  assert.deepEqual(d.seats, []);
  assert.equal(d.humanName, "John Doe");
});

test("new seats are named and colored after their model", () => {
  assert.equal(friendlySeatName("anthropic/claude-opus-5.5"), "Claude");
  assert.equal(friendlySeatName("~google/gemini-pro-latest"), "Gemini");
  assert.equal(friendlySeatName("openai/gpt-6-astra"), "ChatGPT");
  assert.equal(friendlySeatName("x-ai/grok-4.7"), "Grok");
  assert.equal(friendlySeatName("~deepseek/deepseek-pro-latest"), "DeepSeek");
  assert.equal(friendlySeatName("qwen/qwen3.8-max-0902"), "Qwen");
  assert.equal(friendlySeatName("z-ai/glm-5.3", "Z.ai: GLM 5.3"), "GLM 5.3");
  assert.equal(friendlySeatName("brand-new/model-x"), "model-x");
  assert.equal(friendlySeatName("lmstudio/google/gemma-4-31b-qat", "Gemma 4 31B QAT (LM Studio)"), "Gemma 4 31B QAT", "LM Studio's: after the model, not Gemini");
  const s = setup();
  assert.equal(uniqueSeatName("Claude", s.seats), "Claude 2");
  assert.equal(uniqueSeatName("Claude", s.seats, "A"), "Claude", "its own name doesn't count");
  assert.equal(uniqueSeatName("Qwen", s.seats), "Qwen");
  assert.equal(seatColorFor("Qwen", s.seats), "#615ced");
  assert.equal(seatColorFor("Claude 2", s.seats), "#8e44ad", "family color taken: next free color");
  assert.equal(seatColorFor("Claude", s.seats, "A"), "#c96442");
});

test("a message ending with a participant's name is addressed to it", () => {
  const seat = (id: string, name: string) => ({ id, name, model: "m", role: "", effort: "default", color: "#000" });
  const seats = [seat("A", "Claude"), seat("B", "Claude 2"), seat("C", "Grok the Skeptic"), seat("D", "GPT")];
  const to = (text: string) => addressedSeat(text, seats)?.id;
  assert.equal(to("What do you think, Claude?"), "A");
  assert.equal(to("what do you think, claude"), "A", "case doesn't matter");
  assert.equal(to("Over to you, Claude 2."), "B", "the longest name wins");
  assert.equal(to("Your turn, grok the skeptic!!"), "C", "names of several words");
  assert.equal(to("Claude"), "A", "the whole message");
  assert.equal(to("(GPT)"), "D", "punctuation around it");
  assert.equal(to("I agree with Claude."), "A", "the rule is simply the last word(s), whatever the sense");
  assert.equal(to("I asked Claude yesterday."), undefined);
  assert.equal(to("What do you think, Claude, honestly?"), undefined, "not at the end");
  assert.equal(to("That's very Claudeish"), undefined, "part of a longer word");
  assert.equal(to("I read about the ChatGPT"), undefined, "GPT inside a longer word");
  assert.equal(to("Tell me about episode 2"), undefined);
  assert.equal(to(""), undefined);
});

test("“team” at the end calls on everyone; “independently, team” on each separately; slips forgiven", () => {
  // In turn
  for (const t of ["What do you all think, team?", "what do you think team", "Thoughts, TEAM!", "team"]) assert.equal(teamCall(t), "in turn", t);
  // Typing slips of "team"
  for (const t of ["Thoughts, tema?", "Thoughts, taem.", "Thoughts, tem", "Thoughts, teaam", "Thoughts, tean", "Thoughts, rteam"]) {
    assert.equal(teamCall(t), "in turn", t);
  }
  // Real words a slip away from "team" don't count
  for (const t of ["…in the long term.", "Have a cup of tea.", "Full steam.", "Both teams.", "A tear.", "The beam", "Teal", "teem"]) {
    assert.equal(teamCall(t), undefined, t);
  }
  // Independently, either order, with slips
  for (const t of [
    "Your views, independently, team?",
    "independently team",
    "Team, independently.",
    "team independantly",
    "Independantly, tema!",
    "idnependently, taem",
    "indepentently, team",
    "independent, team",
  ]) {
    assert.equal(teamCall(t), "independently", t);
  }
  assert.equal(teamCall("dependently, team"), "in turn", "“dependently” isn't a slip of “independently”");
  // "parallel" or "in parallel" means the same as "independently", before or after "team", slips forgiven
  for (const t of ["Your views, parallel, team", "In parallel, team!", "team in parallel", "Team, parallel.", "Views, paralel, team", "Views, paralell team", "Views, parralel, team"]) {
    assert.equal(teamCall(t), "independently", t);
  }
  // …but not other real words a slip or two away
  for (const t of ["Draw some parallels, team", "Tell us a parable, team", "Mind the parallax, team"]) assert.equal(teamCall(t), "in turn", t);
  assert.equal(teamCall("Run these in parallel."), undefined, "“in parallel” alone calls on no one");
  assert.equal(teamCall("independently"), undefined);
  assert.equal(teamCall("We asked the team independently of you"), undefined, "only the last word(s) count");
  assert.equal(teamCall(""), undefined);
  assert.equal(editDistance("tema", "team"), 1, "a swap is one slip");
  assert.equal(editDistance("kitten", "sitting"), 3);
});

test("the words meant for Dialog come off the end of the message; the sentence's own punctuation stays", () => {
  const seat = (id: string, name: string) => ({ id, name, model: "m", role: "", effort: "default", color: "#000" });
  const seats = [seat("A", "Claude"), seat("B", "Claude 2"), seat("G", "Grok")];
  const read = (t: string) => {
    const a = readAddress(t, seats);
    return [a.text, a.seats.length === 1 ? a.seats[0]!.id : (a.call ?? null)];
  };
  assert.deepEqual(read("What do you think, Grok?"), ["What do you think?", "G"]);
  assert.deepEqual(read("Over to you, Claude 2."), ["Over to you.", "B"]);
  assert.deepEqual(read("Thoughts? Grok."), ["Thoughts?", "G"], "no doubled punctuation");
  assert.deepEqual(read("Grok"), ["", "G"], "nothing left but the name");
  assert.deepEqual(read("What do you all think, team?"), ["What do you all think?", "in turn"]);
  assert.deepEqual(read("What do you all think, tema?"), ["What do you all think?", "in turn"]);
  assert.deepEqual(read("Your views, independantly, team."), ["Your views.", "independently"]);
  assert.deepEqual(read("Your views — team, independently!"), ["Your views!", "independently"]);
  assert.deepEqual(read("Line one\nLine two, team"), ["Line one\nLine two", "in turn"], "line breaks inside are kept");
  assert.deepEqual(read("independently, team"), ["", "independently"]);
  assert.deepEqual(read("Your views, in parallel, team."), ["Your views.", "independently"], "“in parallel” comes off whole");
  assert.deepEqual(read("Your views — team, in parallel!"), ["Your views!", "independently"]);
  assert.deepEqual(read("Your views, parallel team"), ["Your views", "independently"]);
  assert.deepEqual(read("Run these in parallel."), ["Run these in parallel.", null], "with no one called, it's just words");
  assert.deepEqual(read("Nothing for Dialog here."), ["Nothing for Dialog here.", null]);
  assert.deepEqual(read("Think about the long term."), ["Think about the long term.", null]);
  assert.equal(addresseeLabel({ seatId: "G", name: "Grok (old name)" }, seats), "to Grok", "the current name");
  assert.equal(addresseeLabel({ seatId: "Z", name: "Gone" }, seats), "to Gone", "a removed seat keeps its name");
  assert.equal(addresseeLabel({ everyone: "independently" }, seats, true), "to everyone, each replying without seeing the others' replies");
});

test("a list of names at the end asks just those participants, in the order named", () => {
  const seat = (id: string, name: string) => ({ id, name, model: "m", role: "", effort: "default", color: "#000" });
  const seats = [seat("A", "Claude"), seat("B", "Claude 2"), seat("G", "Grok"), seat("M", "Gemini Pro"), seat("O", "GPT")];
  const read = (t: string) => {
    const a = readAddress(t, seats);
    return [a.text, a.seats.map((x) => x.id).join(" "), a.call ?? null, Boolean(a.everyone)];
  };
  assert.deepEqual(read("What do you think, Grok and Claude?"), ["What do you think?", "G A", "in turn", false]);
  assert.deepEqual(read("Views? Claude, Grok, Gemini Pro."), ["Views?", "A G M", "in turn", false], "the order typed");
  assert.deepEqual(read("Your take, claude 2 & gpt"), ["Your take", "B O", "in turn", false], "longest name; “&”");
  assert.deepEqual(read("Your take, Grok + GPT / Claude"), ["Your take", "G O A", "in turn", false], "“+” and “/”");
  assert.deepEqual(read("Your take, Grok, and GPT!"), ["Your take!", "G O", "in turn", false], "a comma before “and”");
  assert.deepEqual(read("Grok Claude"), ["", "G A", "in turn", false], "just spaces between");
  assert.deepEqual(read("Your take, Grok and Grok"), ["Your take", "G", null, false], "a name twice counts once");
  assert.deepEqual(read("Your views, Claude and Grok, independently."), ["Your views.", "A G", "independently", false]);
  assert.deepEqual(read("Your views, independantly Claude and Grok?"), ["Your views?", "A G", "independently", false]);
  assert.deepEqual(read("Your view, Grok, independently."), ["Your view.", "G", null, false], "one name: “independently” just comes off");
  assert.deepEqual(read("Your views, Claude and Grok, in parallel."), ["Your views.", "A G", "independently", false], "“in parallel” after the list");
  assert.deepEqual(read("Your views, in parallel Claude and Grok?"), ["Your views?", "A G", "independently", false], "and before it");
  assert.deepEqual(read("Your views, parallel, Claude & Grok"), ["Your views", "A G", "independently", false]);
  assert.deepEqual(read("Your view, Grok, in parallel."), ["Your view.", "G", null, false], "one name: “in parallel” just comes off");
  assert.deepEqual(read("Rock and roll, Grok"), ["Rock and roll", "G", null, false], "“and” only joins names");
  assert.deepEqual(read("Ask the grand Grok"), ["Ask the grand", "G", null, false], "“grand” isn't “and”");
  assert.deepEqual(read("Thoughts, team?"), ["Thoughts?", "", "in turn", true]);

  const label = (a: Parameters<typeof addresseeLabel>[0], forModels = false) => addresseeLabel(a, seats, forModels);
  const pair = { seats: [{ id: "A", name: "Claude" }, { id: "G", name: "Grok" }], how: "in turn" as const };
  assert.equal(label(pair), "to Claude and Grok, in turn");
  assert.equal(label(pair, true), "to Claude and Grok, each replying in turn");
  const three = { seats: [{ id: "A", name: "Claude" }, { id: "G", name: "Grok" }, { id: "Z", name: "Gone" }], how: "independently" as const };
  assert.equal(label(three), "to Claude, Grok and Gone, independently");
  assert.equal(label(three, true), "to Claude, Grok and Gone, each replying without seeing the others' replies");
});

// ---------------------------------------------------------------------------
// Files the participants make

test("files come out of a reply: <file name=…> on its own line, up to </file>", () => {
  const raw = [
    "Here is the plan.",
    "",
    '<file name="plan.md">',
    "# Plan",
    "Step one.",
    "</file>",
    "",
    "And a drawing:",
    "```svg",
    "<file name='orbit.svg'>",
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
    "</file>",
    "```",
    "Done.",
  ].join("\n");
  const s = splitFiles(raw);
  assert.equal(s.text, "Here is the plan.\n\nAnd a drawing:\n\nDone.", "file blocks (and a fence left empty) taken out");
  assert.deepEqual(s.files, [
    { name: "plan.md", content: "# Plan\nStep one." },
    { name: "orbit.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>' },
  ]);
  assert.equal(s.writing, undefined);

  // A code fence wrapped around the whole contents is dropped.
  const fenced = splitFiles('<file name="page.html">\n```html\n<p>Hi</p>\n```\n</file>');
  assert.equal(fenced.files[0]!.content, "<p>Hi</p>");
  assert.equal(fenced.text, "");

  // Not at the start of a line: talk about the format, not a file.
  const talk = 'Write files as <file name="x.md"> … </file>, Grok.';
  assert.deepEqual(splitFiles(talk), { text: talk, files: [], writing: undefined });

  // Still arriving: the open file is being written; finished: it's kept, marked incomplete.
  const partial = 'Coming up.\n<file name="page.html">\n<html><body>Hel';
  assert.deepEqual(splitFiles(partial, true), { text: "Coming up.", files: [], writing: { name: "page.html", size: 15 } });
  assert.deepEqual(splitFiles(partial).files, [{ name: "page.html", content: "<html><body>Hel", incomplete: true }]);
});

test("file names are made safe; the kind comes from the extension", () => {
  assert.equal(cleanFileName("notes.md"), "notes.md");
  assert.equal(cleanFileName("../../etc/passwd"), "passwd.txt");
  assert.equal(cleanFileName("C:\\Users\\x\\a<b>.html"), "ab.html");
  assert.equal(cleanFileName("  Orbit  diagram.svg "), "Orbit diagram.svg");
  assert.equal(cleanFileName(""), "file.txt");
  assert.equal(cleanFileName("..."), "file.txt");
  assert.equal(cleanFileName("x".repeat(150) + ".html").length, 100);
  assert.ok(cleanFileName("x".repeat(150) + ".html").endsWith(".html"));
  assert.deepEqual(["a.html", "a.HTM", "a.svg", "a.md", "a.markdown", "a.txt", "a.csv", "a"].map(madeKind), [
    "html", "html", "svg", "md", "md", "txt", "txt", "txt",
  ]);
  assert.equal(describeMadeFile({ id: "x", name: "page.html", kind: "html", size: 2048 }), "page.html (web page, 2 KB)");
});

test("every participant is told how to make files, after the house rules and before About you", () => {
  const s = setup();
  s.aboutHuman = "Retired engineer.";
  const p = systemPromptFor(s.seats[0] as Seat, s);
  assert.ok(MAKING_FILES_NOTE.includes('<file name="name.ext">'));
  const note = MAKING_FILES_NOTE.split("{humanName}").join("Bill");
  assert.ok(p.includes(note));
  assert.ok(p.indexOf("No answer, or a qualified one") < p.indexOf("Making files:"));
  assert.ok(p.indexOf("Making files:") < p.indexOf("About Bill"));
  assert.ok(p.indexOf("About Bill") < p.indexOf("Your role in this conversation"));
});

test("files reach the others after the reply's text; the maker sees its own; later versions replace earlier", () => {
  const s = setup();
  const [A, B, C] = s.seats as [Seat, Seat, Seat];
  const file = (id: string, name: string, data: string, extra: Partial<MadeFile> = {}): MadeFile => ({
    id, name, kind: madeKind(name), size: data.length, data, ...extra,
  });
  const entries = [
    human("Make me a plan."),
    bot(A, "Here it is.", { made: [file("p1", "plan.md", "v1"), file("d1", "draft.txt", "old", { removed: true, data: undefined })] }),
    bot(B, "", { made: [file("g1", "grok.svg", "<svg/>", { incomplete: true })] }),
    bot(A, "Revised.", { made: [file("p2", "Plan.md", "v2")] }),
    bot(B, "A private one.", { privateWith: "B", made: [file("s1", "secret.md", "hush")] }),
  ];
  assert.deepEqual([...replacedFiles(entries)], ["p1"], "same name, any case: the later replaces the earlier");

  const forC = JSON.stringify(buildMessages(C, s, entries));
  assert.ok(forC.includes("(Claude's file plan.md was here; a later version of it comes further on.)"));
  assert.ok(forC.includes("(Claude's file draft.txt was here; Bill has since removed it.)"));
  assert.ok(forC.includes('Grok says:\\n\\n<file name=\\"grok.svg\\">\\n<svg/>\\n</file>\\n(This file may be incomplete'));
  assert.ok(forC.includes('Claude says:\\nRevised.\\n\\n<file name=\\"Plan.md\\">\\nv2\\n</file>'));
  assert.ok(!forC.includes("hush"), "a file in a private reply stays private");
  assert.ok(!forC.includes("v1"), "the replaced version's contents aren't sent again");

  // The maker sees its own reply with its own files, as it wrote them.
  const forA = buildMessages(A, s, entries);
  assert.equal(forA[2]?.role, "assistant");
  assert.equal(
    forA[2]?.content,
    "Here it is.\n\n(Claude's file plan.md was here; a later version of it comes further on.)\n\n(Claude's file draft.txt was here; Bill has since removed it.)",
  );
  assert.equal(forA[4]?.content, 'Revised.\n\n<file name="Plan.md">\nv2\n</file>');

  // Grok, who can see its private file.
  assert.ok(JSON.stringify(buildMessages(B, s, entries)).includes("hush"));

  // A reply made of nothing but files still counts.
  assert.equal(isSettled(bot(B, "", { made: [file("x", "x.md", "x")] })), true);
  assert.equal(isSettled(bot(B, "", {})), false);
});

test("the model picker's order: by name, or by input or output price either way; routers last", () => {
  const m = (id: string, name: string, inputPrice: number, outputPrice: number) => ({ id, name, inputPrice, outputPrice, contextLength: 1, inputModalities: ["text"], tools: true });
  const list = [m("c", "Charlie", 4, 20), m("r", "Router", -1, -1), m("a", "Alpha", 2, 6), m("b", "Bravo", 2, 1), m("f", "Free", 0, 0)];
  const order = (sort: Parameters<typeof sortModels>[1]) => sortModels(list, sort).map((x) => x.id).join("");
  assert.equal(order("name"), "abcfr");
  assert.equal(order("in-asc"), "fabcr", "a tie (Alpha, Bravo at $2) in name order");
  assert.equal(order("in-desc"), "cabfr", "routers last either way");
  assert.equal(order("out-asc"), "fbacr");
  assert.equal(order("out-desc"), "cabfr");
  assert.deepEqual(list.map((x) => x.id), ["c", "r", "a", "b", "f"], "the list itself is left as it was");
});

test("“…privately” as the very last word: private to whoever the message is for; the word comes off", () => {
  const seat = (id: string, name: string) => ({ id, name, model: "m", role: "", effort: "default", color: "#000" });
  const seats = [seat("A", "Claude"), seat("B", "Claude 2"), seat("G", "Grok")];
  const read = (t: string) => {
    const a = readAddress(t, seats);
    return [a.text, a.seats.map((x) => x.id).join(" "), a.call ?? null, Boolean(a.everyone), Boolean(a.privately)];
  };
  assert.deepEqual(read("What do you think, Grok, privately?"), ["What do you think?", "G", null, false, true]);
  assert.deepEqual(read("Between us, Claude and Grok, privately."), ["Between us.", "A G", "in turn", false, true]);
  assert.deepEqual(read("Your views, Claude and Grok, independently, privately"), ["Your views", "A G", "independently", false, true]);
  assert.deepEqual(read("Just between us, privately"), ["Just between us", "", null, false, true], "naming no one");
  assert.deepEqual(read("Thoughts, team, privatly"), ["Thoughts", "", "in turn", true, true], "a slip, and “team”");
  assert.deepEqual(read("Let's keep this private"), ["Let's keep this private", "", null, false, false], "“private” isn't “privately”");
  assert.deepEqual(read("We spoke privately, Grok"), ["We spoke privately", "G", null, false, false], "only as the very last word");
  assert.deepEqual(read("privately"), ["", "", null, false, true]);
});

test("“…only” right after names or “team” means “privately”; anywhere else it's just a word", () => {
  const seat = (id: string, name: string) => ({ id, name, model: "m", role: "", effort: "default", color: "#000" });
  const seats = [seat("A", "Claude"), seat("B", "Claude 2"), seat("G", "Grok")];
  const read = (t: string) => {
    const a = readAddress(t, seats);
    return [a.text, a.seats.map((x) => x.id).join(" "), a.call ?? null, Boolean(a.everyone), Boolean(a.privately)];
  };
  assert.deepEqual(read("What do you think, Grok only?"), ["What do you think?", "G", null, false, true]);
  assert.deepEqual(read("Between us, Claude and Grok, only."), ["Between us.", "A G", "in turn", false, true]);
  assert.deepEqual(read("Your views, Claude and Grok, in parallel, only"), ["Your views", "A G", "independently", false, true]);
  assert.deepEqual(read("Thoughts, team only"), ["Thoughts", "", "in turn", true, true], "“team”");
  assert.deepEqual(read("Hush, Grok, ONLY"), ["Hush", "G", null, false, true], "case doesn't matter");
  assert.deepEqual(read("Answer in one sentence only"), ["Answer in one sentence only", "", null, false, false], "no name before it");
  assert.deepEqual(read("Just between us, only"), ["Just between us, only", "", null, false, false], "naming no one");
  assert.deepEqual(read("Only you, Grok"), ["Only you", "G", null, false, false], "only as the very last word");
});

test("a private exchange with several: only its members see the message and the replies, each told who else can", () => {
  const s = setup();
  const [A, B, C] = s.seats as [Seat, Seat, Seat];
  const group = ["A", "B"];
  const entries: Entry[] = [
    human("Hello all."),
    { ...human("Between us two."), privateWith: group, addressedTo: { seats: [{ id: "A", name: "Claude" }, { id: "B", name: "Grok" }], how: "in turn" } },
    bot(A, "A's private reply.", { privateWith: group }),
    bot(B, "B's private reply.", { privateWith: group }),
  ];
  const forC = JSON.stringify(buildMessages(C, s, entries));
  assert.ok(forC.includes("Hello all."));
  assert.ok(!forC.includes("Between us") && !forC.includes("private reply"), "an outsider sees none of it");
  const forB = buildMessages(B, s, entries).map((m) => m.content).join("\n");
  assert.ok(forB.includes("Bill says (privately, only you and Claude can see this; to Claude and Grok, each replying in turn):\nBetween us two."));
  assert.ok(forB.includes("Claude says (privately; only Bill and you can see this):\nA's private reply."));
  const forA = buildMessages(A, s, entries);
  assert.ok(String(forA.at(-1)?.content).includes("Grok says (privately; only Bill and you can see this):\nB's private reply."));
  assert.equal(forA[2]?.role, "assistant");
  assert.equal(forA[2]?.content, "A's private reply.", "its own reply, as it wrote it");
  // The stage directions on screen and in saved files.
  assert.equal(privateLabel(entries[1]!, s.seats, "Bill"), "privately, to Claude and Grok, in turn");
  assert.equal(privateLabel(entries[2]!, s.seats, "Bill"), "privately, to Bill and Grok");
  assert.equal(privateLabel(human("x", "B"), s.seats, "Bill"), "privately, to Grok", "one seat, stored as it always was");
  assert.equal(privateLabel(bot(B, "y", { privateWith: "B" }), s.seats, "Bill"), "privately, to Bill");
  assert.equal(privateLabel(entries[0]!, s.seats, "Bill"), undefined);
  assert.equal(privateWithFor(["A"]), "A");
  assert.deepEqual(privateWithFor(["A", "B"]), ["A", "B"]);
  assert.equal(privateWithFor([]), undefined);
  assert.deepEqual(privateGroup({ privateWith: "A" }), ["A"]);
  assert.equal(canSee("C", { privateWith: group }), false);
  assert.equal(canSee("C", {}), true);
});

test("particulars: the host after the model, once known; a note while it is being looked up", () => {
  const e: Entry = { id: "r", speaker: "A", speakerName: "Qwen", text: "Hi.", time: "t", status: "done", model: "qwen/qwen3.8-max", cost: 0.001 };
  assert.ok(!turnDetails(e).some((l) => l.startsWith("Host")), "unknown: left out");
  assert.equal(turnDetails(e, undefined, true)[1], "Host: looking up…");
  assert.deepEqual(turnDetails({ ...e, host: "Alibaba" }).slice(0, 2), ["Model: qwen/qwen3.8-max.", "Host: Alibaba."]);
});
