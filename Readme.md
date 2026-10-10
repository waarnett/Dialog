# Dialog

A moderated group conversation between you and several AI models (Claude, ChatGPT, Gemini,
Grok, DeepSeek, or any other model OpenRouter offers), running as a single web page in your
browser; Safari and Chrome are both known to work. You decide who speaks next; every
participant sees the same conversation, except for private exchanges you have with one of
them.

## Getting started

1. **Get an OpenRouter key.** At openrouter.ai, sign in, add a small amount of credit
   (Credits page), then create a key (Keys page). Give the key a **credit limit**: it caps
   what Dialog can ever spend. A limit is a cap, not money; OpenRouter never spends past
   the credit you've bought. A limit can also be set to reset daily, weekly or monthly.
2. **Open `dialog.html`** in your browser (double-click it, or drag it onto a browser
   window).
3. Click **Settings**: paste the key, put in **your name** (it starts as "John Doe") and,
   if you like, a few sentences **about you**. Click **Done**.
4. **Add participants.** Under Participants, on the right, press **+ Add a seat** and choose
   a model. Each new seat is named after its model ("Claude", "Grok"…) and takes that
   family's color; rename it if you like. Add as many as you want, including several of
   the same model.
5. **Optional: a management key, to see your remaining credit.** OpenRouter shows the
   account's remaining credit only to a *management key*, a separate kind of key that can
   create, change and delete your API keys but can't talk to the models. Create one at
   openrouter.ai/settings/management-keys, giving it an expiration date (90 days or a
   year), and paste it into Settings under "OpenRouter management key". Dialog uses it for
   nothing but reading your credit. The risk: someone who got hold of it could make new
   keys without limits, so the most they could spend is your remaining credit (plus any
   automatic top-up, if you've turned that on).

Until there is a first entry, the conversation area shows a short **welcome**: how to begin,
including a reminder that the house rules can be edited in Settings, beside an engraving of
Socrates. Steps you've already done (the key, adding seats) drop off. A note under the steps
points out that the participants don't get the hidden instructions their makers' own chat
apps use (see How the participants are kept separate, below), so they may answer
differently than those apps would.

## The top bar

- **This conversation:** what its replies have cost, as reported by OpenRouter.
  OpenRouter's 5.5% fee on credit purchases comes on top.
- **Credit left** (only with a management key): your account's remaining credit, across
  all your keys. Hover for credit bought and used; click it to open OpenRouter's Credits
  page in a new tab, where you can add more.
- **This month:** what this API key has spent in the current calendar month. Months begin
  at midnight UTC, which is 5 pm Pacific in summer and 4 pm in winter. Hover for the key's
  all-time spending and its limit.
- **Save All** (or **Save Selected**), **New conversation**, **Settings**: see below.

A **notice** appears under the top bar when something needs attention: no API key yet
(click the notice to open Settings), or the browser refusing to let Dialog save, in which case
the conversation and settings will be lost when the page closes.

## Participants

Each participant ("seat") has a card on the right:

- **⠿ (the handle)**, left of the name, moves the card: drag it up or down, and a line
  shows where it will land. Or click it and press ↑ or ↓. The order is the order of the To
  menu, of the participant list every seat is given, and of Participants in saved files.
  Since that list is part of every seat's instructions, a new order means each seat's
  next turn re-reads the conversation at full price once (no re-reading discount).
- **Name**, at the top of the card, in the seat's color. Click it to rename. The name is
  what the others see ("Skeptic says: …") and what appears in the margin of the
  conversation.
- **+ copy** adds another seat with the same model and settings, a new name ("Claude 2")
  and a darker shade of the color, without the role.
- **×** removes the seat. Its earlier contributions stay in the conversation.
- **The model button** opens the model picker, a list of every OpenRouter model with its
  price (dollars per million tokens, input / output):
  - Type a few words ("opus", "gemini pro") to narrow the list; the current model is
    marked "(current)".
  - Click a model, or use ↑ ↓ (Page Up / Page Down to jump) and Return.
  - Escape, Cancel, or a click outside the list closes it without changing anything.
  - Any model id can be typed in full (it contains a "/"); a "Use … as typed" row appears.
  - The list comes from OpenRouter and is refreshed every 12 hours.
- Under the button: the model's **id and price**, or a warning if the id isn't in
  OpenRouter's current list.
- **Web search and page reading** are always on; there is nothing to set (see Searching
  and reading web pages, below). If the model can't use tools, the card says "Can't use
  tools, so no web search or page reading".
- **Thinking** offers exactly the levels the chosen model lists on its OpenRouter page,
  highest first, with the model's own default marked. Models with no thinking setting show
  "not adjustable". Hidden thinking is billed as output.
- **Role** opens a box for that participant's standing instructions, e.g. "argue the
  skeptic's side". It shows "(set)" or "(none)".
- **Speak** asks the participant to reply now. Only one participant speaks at a time; while
  one does, its card is outlined, the other Speak buttons wait, and its **Stop** button ends
  the reply early.
- The participant's **cost so far** in this conversation, at the bottom right of the card.

## Talking

- **Your input box** is at the bottom. With **To: Everyone**, **Add to conversation**, or
  **⌘↩** (Command-Return; Ctrl+Enter on other systems), puts your message into the
  conversation; nobody answers until you press a participant's **Speak** button.
  **Shift-Return** or **Option-Return** starts a new line in the box.
- **Return** adds your message *and* asks a participant to reply, so a back-and-forth needs
  no clicking:
  - If your message ends with a participant's name, that participant replies: "…what do
    you think, Grok?" asks Grok. Case and punctuation don't matter, the name must be a word
    of its own ("Claudeish" doesn't count), and the longest name wins ("…Claude 2" asks
    Claude 2, not Claude). It goes by the last word only, so "I agree with Claude." asks
    Claude too.
  - Otherwise the participant who spoke last replies. Only the open conversation counts; a
    private exchange doesn't change who is next.
  - **The name is for Dialog, not part of your message.** Dialog takes it off ("What do you
    think, Grok?" becomes "What do you think?") and shows your message with a stage
    direction under your name: "(to Grok)". The participants are told the same thing in
    plain words ("Bill says (to Grok): …"), so everyone still knows whom you asked.

  The note beside the button shows who it will be and changes as you type: "↩ adds, then
  Grok replies · ⌘↩ just adds". If no participant has spoken yet and none is named, or
  while a reply is still arriving, Return only adds your message. With the box empty it
  does nothing, so a stray keypress never pays for a reply. Return that finishes typing a
  character with an input method (for Chinese or Japanese, say) is left alone.
- **"…, team"** at the end of your message has every participant reply once, in turn,
  when you press Return. Like a name, "team" (and "independently") is for Dialog: it's
  taken off your message, which is marked "(to everyone, in turn)" or "(to everyone,
  independently)", and the participants are told that in plain words instead. They go around the table in card order, starting with the one
  after the last speaker, so nobody speaks twice in a row. Each sees the replies before
  it. The note beside the button says how many and who goes first ("↩ adds, then all 5
  reply in turn, Claude first"); hover over it for the whole order.
  - **"…independently, team"** (or "…team, independently") has each reply without seeing
    the others' replies from that round, which avoids everyone following whoever answered
    first. Those replies are marked "(answering independently)", here and in saved files.
    Afterwards everyone sees them all, as usual.
  - Typing slips are forgiven ("tema", "taem", "teamm", "independantly", "idnependently"),
    but real words one slip from "team" don't count: "…in the long term." doesn't start a
    round, nor do "tea", "steam", "teams", "tear", "beam" and the like. A participant's
    name at the end still wins: "…what about you, Grok?" asks Grok alone.
  - Participants without a model are skipped. While a round runs, the Speak buttons wait;
    **Stop** ends the reply under way and the rest of the round. A failed reply is skipped
    and the round goes on. A round costs about as much as all the participants' replies
    together, and takes as long as all of them one after another.
- **Speak also adds whatever you've typed and attached** before the participant replies, so
  one press both says something and asks someone to answer. To have one participant
  respond to another, press the Speak button of the one who should respond, with the box
  empty.
- **To: Privately: <name>** sends a message to that participant only. The box turns
  parchment-colored and the button reads "Send privately to <name>"; Return and ⌘↩ do the
  same. The participant answers at once. Both entries are set on parchment and marked like stage directions,
  "(privately, to Grok)" and "(privately, to John Doe)", and no other participant ever sees
  them. The participant itself remembers them, as it would in its own chat window.
- **Replies appear as they are written.** "thinking…" shows until the first words arrive.
  Replies are formatted from Markdown (headings, lists, tables, code); links open in a new
  tab. If a model begins its reply with its own label ("Claude says:"), Dialog removes it.
- **Each turn** shows, in the margin, a tick box for saving (see Saving, below), the time
  it began and the speaker's name; hover over a participant's name to see the exact model
  that answered and the thinking level it was given. After the text come any **sources**, then the **cost** (hover for token
  counts, including how much was re-read at the discount and how much was stored for
  re-reading), the **speed** (below), and "stopped early" if you stopped it.
- **× on a turn** (it appears when you hover over the turn) removes it, so no participant
  sees it from then on.
- **Stopped replies** keep what arrived, and the others will see it.
- **When a reply fails**, Dialog shows OpenRouter's message plus whatever particulars it
  sent: which host failed, the host's own error code or words, and the request id
  ("gen-…"). When a host fails partway through, OpenRouter replaces its message with a
  generic one (for example "JSON error injected into SSE stream"), so those particulars are
  often the only real clue; the request id can be looked up on OpenRouter's Activity page.
  **Try again** replaces the failed reply with a fresh attempt by the same participant,
  without touching anything you've typed. Failed replies are never shown to any
  participant.
- **When a model is withdrawn** from OpenRouter, that seat's card shows "… is not in
  OpenRouter's current list" (once Dialog's copy of the list is refreshed, within 12 hours),
  and pressing its Speak button gives a failed reply that says the model is no longer
  listed and to choose another with the seat's model button. Nothing else is affected. The
  seat keeps its name, role and earlier turns; its new model will take those earlier
  replies as its own. Model ids beginning with "~" (such as "~google/gemini-pro-latest")
  follow the newest version, so they don't go away. If a model is still listed but all its
  hosts are down, the failed reply says that may be the cause; try again later.

### Searching and reading web pages

Every participant whose model can use tools may **search the web** and **read web pages**,
deciding for itself when to. OpenRouter does both on its behalf.

- **Searching:** Claude, and models that use OpenRouter's own search (DeepSeek and Qwen, for
  instance), stop at 10 searches per reply. Models that use their maker's own search
  (OpenAI's, Google's, xAI's) set their own pace; OpenRouter doesn't pass them a limit. A
  search costs about 1 to 3 cents. Sources a participant used are listed under its reply.
- **Reading a page:** a participant can read any web page or online PDF whose address
  comes up in the conversation, whether you typed it or another participant did. Reading
  costs at most a tenth of a cent, plus the page's text at the model's input price: a long
  page of 30,000 tokens adds about 12 cents with Claude Opus 5.5, 30 cents with GPT-6
  Astra.
- **Only the reader sees the page.** The others see only what it says about the page, and
  Dialog keeps only the replies, not the pages. So if another participant wants the
  details, it reads the page for itself, and a participant that wants to look again later
  reads it again. Each reading is paid once. That is usually cheaper than attaching the
  page as a file, which every participant re-reads every time it speaks: the same page
  attached would cost about 29 cents over 10 turns of one Claude seat (re-reads are
  discounted), and $1.20 with a model that gives no discount. Attach it instead (save it as
  a PDF and drag it in) when everyone should work from exactly the same copy, or when a
  site won't let OpenRouter in.

### Speed

After each reply, next to its cost, is its speed in tokens per second: the tokens the model
wrote (its hidden thinking included, since that is billed and takes time) divided by the
seconds from pressing Speak to the last word. That time includes thinking, any web searches
and network delay, so it measures how fast the participant answers you, not raw model
speed. Hover over it for the breakdown: how long until the first words appeared, and how
fast the visible text arrived after that, which is the closer measure of raw generation
speed. Stopped and failed replies have no speed (OpenRouter reports no token count for
them).

## Attaching files

Drag files onto the conversation (a dashed outline shows where to drop) or click
**Attach…**. They wait above your input box (× drops one) and go out with your next
message: with **Add to conversation**, with a **Speak** press, or privately when To: names a
participant. In the conversation they appear under the message: images as pictures, other
files by name and size.

- Text files (Markdown, plain text, CSV, code and the like) are sent as text.
- Images (PNG, JPEG, WebP, GIF) are sent as images; large ones are scaled down first. A
  participant whose model can't view images is told an image was shared.
- PDFs go to models that read PDFs themselves; for the others, OpenRouter converts them to
  text with its free converter (Dialog asks for that one explicitly, because the paid
  default costs $2 per 1,000 pages and a PDF is re-sent every turn).
- Word, Pages, Excel and similar files can't be read; Dialog says so and suggests exporting
  them as PDF. Other refusals (a file too large, a type Dialog can't read) appear above the
  input box.
- What some models take in, per OpenRouter's model list on 2026 Oct 07. Text files work
  with every model, since they arrive as ordinary text. Dialog checks OpenRouter's current
  list each time, so it adapts if this changes.

  | Model | Images | PDFs |
  |---|---|---|
  | Claude Opus 5.5 | yes | read by the model itself |
  | GPT-6 Astra | yes | read by the model itself |
  | Gemini Pro (latest; now Gemini 3.1 Pro Preview) | yes | read by the model itself |
  | Grok 4.7 | yes | read by the model itself |
  | DeepSeek Pro (latest; now DeepSeek V4 Pro 0813) | no; told an image was shared | converted to text by OpenRouter |
  | Qwen 3.8 Max, Max Prime, Omni Flash | yes | converted to text by OpenRouter |

  A model can misread an image even when it receives it. To check that one really saw a
  picture, ask about a detail only the picture shows.
- **Cost:** like everything in the conversation, a file is re-read by each participant every
  time it speaks. Text files show their approximate size in tokens, and Dialog asks before
  attaching one over 50,000 tokens.
- Files are stored in the browser separately from the conversation. Browsers allow each page
  only a few megabytes in all, so a very large file may not fit; it is then marked "not saved"
  and lasts until the page closes. Removing a turn, or starting a new conversation, frees
  the space its files used. A file that could not be kept is marked "no longer available",
  and participants are told so.

## Saving and starting over

- **Save All** (top bar) saves the whole conversation as one web page, styled like Dialog
  and readable in any browser: participants with their models, thinking levels and roles; the first sentence of your About-you text, under your name; every
  turn, set as a dialogue, with private exchanges included and marked (and the other stage
  directions too: "(to Grok)", "(to everyone, in turn)", "(answering independently)");
  attached images
  shown, attached text files tucked into a section you click to open, PDFs listed by name;
  sources; costs, with the conversation's total at the end. A reply given with a different
  model or thinking level from the one its seat has now (you changed it since, or removed
  the seat) is marked with the one it used. Failed replies are left out. The file is named
  like "Dialog 2026 Oct 07 2205.html".
- **Save Selected:** tick the box beside any turns (yours or the participants'; the box is
  faint until you point at the turn) and the top-bar button becomes **Save Selected**. It
  saves just those turns, in order, and lists under Participants only those who speak in
  them; you appear there only if one of your own turns is ticked. The heading says how many
  turns were chosen, and the total at the end is for those turns. The file is named like
  "Dialog 2026 Oct 07 2205 selected.html". Ticks stay after saving, so you can adjust and
  save again; untick them all and the button is Save All again. Ticks are not remembered
  when the page closes, and New conversation clears them.
- **First sentence of About you:** in either kind of file, only the first sentence (or
  first line, if that ends sooner) is shown, and a note says it is only the first sentence.
  Full stops in abbreviations such as "e.g.", "Dr." or "Ph.D." don't end the sentence. The
  participants themselves still get the whole text.
- **Where files go.** In Chrome (and Edge), Dialog opens the Mac's standard Save dialog, so
  you choose the folder and can change the name; Cancel saves nothing. Safari doesn't let a
  web page open that dialog. To get it in Safari anyway, set Safari Settings › General ›
  File download location to "Ask for each download"; Safari then shows the same Save dialog
  for every download. Otherwise Safari saves to your Downloads folder, asking permission
  each time unless, in Safari Settings › Websites › Downloads, "When visiting other
  websites" is set to Allow. This applies to conversations and to settings files alike.
- **New conversation** clears the conversation (save first). Participants and settings stay.
- Between visits, Dialog remembers the conversation, the participants and your settings.

## Settings

- **OpenRouter API key**, with **Show** to check what you pasted.
- **OpenRouter management key (optional)**, to show your remaining credit; see Getting
  started.
- **Your name**: what participants call you, and the name on your turns.
- **About you**: a few sentences every participant receives, on every turn, after the house
  rules and before its role.
- **House rules**: the instructions every participant receives. The defaults cover:
  - how the conversation works: who's present, how messages are labeled, not to speak for
    others, private exchanges;
  - how to contribute: agree briefly rather than repeat, keep contributions to a few
    paragraphs unless asked for more, no flattery of you or of each other, confidence as a
    percentage for claims that matter, with what would raise or lower it, and never 0% or
    100% without hard evidence;
  - how to think: test ideas against particular cases, carry an idea into a new context
    only when the situations are clearly analogous, admit confusion, search or ask when
    information is missing, present the reasonable alternatives with evidence against your
    favorite, keep hypotheticals exact, keep facts apart from value judgements, show each
    step of a chain of reasoning, and prefer a qualified answer to a confident mistake.

  Placeholders filled in for each participant: **{name}** its name, **{humanName}** your
  name, **{participants}** everyone present with their models, **{date}** today's date.
  Edit freely; **Restore default rules** undoes your edits. A role comes after the house
  rules, so a role can override them, e.g. "for this role, argue the other side as strongly
  as you honestly can."

  When the default rules change in a new version of Dialog, a copy you never edited is
  updated to match. An edited copy is left alone, except that a default sentence that has
  since been reworded is updated where it still appears word for word.
- **Save settings to a file…** downloads your name, About you, the house rules and every
  participant (name, model, thinking level, role and color) as one small file, named like
  "Dialog settings 2026 Oct 09 1722.json". Use it as a backup, or to move Dialog to another
  browser or computer. **Include my keys in the saved file** adds your OpenRouter keys; it
  starts unticked each time you open Settings, because anyone who has a file with your keys
  could spend your credit.
- **Restore from a file…** reads such a file, says what it holds and asks before replacing
  your name, About you, house rules and participants. Keys in the file replace yours; if it
  has none, yours stay. The conversation isn't changed: turns by a participant that the
  restored settings don't include stay, as when you remove a seat.
- **Done** closes Settings; so do Escape and a click anywhere outside the Settings window.
  Changes are kept as you type.

## How the participants are kept separate

**Every request goes through your one OpenRouter key.** OpenRouter passes it on to the company
hosting the model using OpenRouter's own account there. Anthropic, OpenAI, Google, xAI and
DeepSeek never see your key; to them, all of Dialog's requests look like ordinary OpenRouter
traffic. (OpenRouter's optional "bring your own key" feature would change that; Dialog
doesn't use it.)

**Two seats running the same model share nothing but the transcript.** The model APIs keep no
memory from one request to the next. Each time a seat speaks, Dialog sends that seat's own
instructions (house rules, About you, its role) and the whole conversation as that seat sees
it, and the model answers from scratch. What makes "Claude-Skeptic" different from
"Claude-Optimist" is only what Dialog sends each one: its name, its role, and its private
exchanges with you. Each seat is told every participant's model, so both know another
participant runs the same model.

**No hidden instructions from the makers' apps.** The ChatGPT, Claude and Gemini apps give
their models long hidden instructions (system prompts) about tone, formatting, safety and
the app's features. Through OpenRouter a model gets none of those; it gets only what Dialog
sends: the house rules, About you and its role. So the same model can sound noticeably
different here than in its maker's app.

**The same model may be served from different places.** OpenRouter may send a Claude request
to Anthropic itself or to Amazon's or Google's cloud; it is the same model either way. For
models whose makers publish them openly, such as DeepSeek's, the host is often a third party.

**Re-reading discount (caching).** Since every turn re-sends the whole conversation, the
providers store recent requests and charge much less for re-reading text they've already
seen. OpenAI, Grok and DeepSeek do this automatically; Claude does it only when asked, so
Dialog asks for its 1-hour cache. Storing text in it costs more than a normal read ($8 instead
of $4 per million tokens for Claude Opus 5.5), but each later re-read costs $0.20 instead of
$4. Dialog uses the 1-hour cache rather than the cheaper 5-minute one because a seat often
waits more than 5 minutes between turns, and a cache that has expired costs more than none.
Each seat's requests also carry their own label so OpenRouter keeps sending them to the host
that already holds that seat's earlier text. Hover over a reply's cost to see how much was
re-read at the discount and how much was stored.

## Where your data lives

The conversation, attached files, settings and your keys are kept in your browser's storage
for this page, on this computer only. Each browser keeps its own: open Dialog in Chrome after
using it in Safari and Chrome starts empty, with no key, participants or conversation. To
carry your setup across, use **Save settings to a file** in one and **Restore from a file**
in the other. Messages go only to OpenRouter, which passes each one to the
model you chose. The management key, if you add one, goes only to OpenRouter's credit
check.

## Look and credits

The page is set like a printed dialogue: each speaker's name hangs in the left margin,
private exchanges are set on parchment and marked like stage directions. Controls use Optima
and the conversation uses Iowan Old Style, both built into macOS; on other systems similar
fonts stand in. Dialog follows your system's light or dark appearance; in dark, the engraving is
shown on a paper-colored mount. In a narrow window, the participants move below the
conversation.

The images are all from a wood engraving of an ancient marble bust of Socrates, signed
W. Meyer: the large picture on the welcome screen, the medallion beside the title, and the
browser-tab icon. `src/icons/` holds the original and the versions made from it.

Safari does not show the tab icon, because of two long-standing Safari (WebKit) bugs: it
won't load a tab icon for a page opened from a file, nor one embedded in the page itself
([WebKit 258969](https://bugs.webkit.org/show_bug.cgi?id=258969),
[WebKit 236616](https://bugs.webkit.org/show_bug.cgi?id=236616)). Chrome shows it.

## For changes: the source

TypeScript sources are in `src/`:

| File | What it does |
|---|---|
| `types.ts` | The data: seats, entries, settings |
| `engine.ts` | The rules: each seat's view of the conversation, house rules, seat names and colors |
| `export.ts` | Saving the whole conversation, or the ticked turns, as an HTML page |
| `openrouter.ts` | Talking to OpenRouter: streaming replies, costs, citations, model list, key and credit |
| `storage.ts` | Saving to and loading from the browser's storage |
| `attachments.ts` | Reading dropped or picked files into attachments |
| `main.ts` | The page: drawing everything and handling clicks |
| `index.html`, `styles.css` | Page skeleton and appearance |
| `icons/` | The Socrates engraving and the welcome picture, medallion and tab icon made from it |

To rebuild (needs Node.js): `npm install`, then `npm run build` (type-checks, then writes
`dist/dialog.html`), and `npm test` (unit tests plus a simulated run of the whole page
against a fake OpenRouter).
