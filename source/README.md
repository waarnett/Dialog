# Dialog

A moderated group conversation between you and several AI models (Claude, ChatGPT, Gemini,
Grok, DeepSeek, or any other model OpenRouter offers, and models running in LM Studio on your
own computer), running as a single web page in your browser; Safari and Chrome are both
known to work. You decide who speaks next; every
participant sees the same conversation, except for private exchanges you have with one of
them.

## Getting started

**No OpenRouter account?** If you run models on your own computer with LM Studio, you can
do without one: skip steps 1 and 6, leave the key empty in Settings, and set up LM Studio
as described in Models on this computer (LM Studio), below. Those models cost nothing, but
they can't search the web or read web pages.

1. **Get an OpenRouter API key.** At openrouter.ai, sign in, add a small amount of credit
   (Credits page), then create a key (Keys page). Give the key a **credit limit**: it caps
   what Dialog can ever spend. A limit is a cap, not money; OpenRouter never spends past
   the credit you've bought. A limit can also be set to reset daily, weekly or monthly.
2. **Open `index.html`** in your browser (double-click it, or drag it onto a browser
   window).
3. Click **Settings** at the top of the page: paste the OpenRouter API key, put in **your
   name** (it starts as "John Doe") and, if you like, a few sentences **about you**. Review
   the **House rules** and edit them if you like.
4. Click **Done**.
5. **Add participants.** Under Participants, on the right, press **+ Add a seat** and choose
   a model. Each new seat is named after its model ("Claude", "Grok"…) and takes that
   family's color; rename it if you like. Add as many as you want, including several of
   the same model. Optionally, give each one a **role**: any text you like. The participant
   receives it, along with the house rules, every time it speaks.
6. **Optional: a management key, to see your remaining credit.** OpenRouter shows the
   account's remaining credit only to a *management key*, a separate kind of key that can
   create, change and delete your API keys but can't talk to the models. Create one at
   openrouter.ai/settings/management-keys, giving it an expiration date (90 days or a
   year), and paste it into Settings under "OpenRouter management key". Dialog uses it for
   nothing but reading your credit. The risk: someone who got hold of it could make new
   keys without limits, so the most they could spend is your remaining credit (plus any
   automatic top-up, if you've turned that on).

Until there is a first entry, the conversation area shows a short **welcome**: how to begin,
including a reminder that the house rules can be edited in Settings, beside an engraving of
Socrates. Steps you've already done (the key, adding seats) drop off. Under the steps, a
link opens this README in a new tab, and a note points out that the participants don't get
the hidden instructions their makers' own chat apps use (see How the participants are kept
separate, below), so they may answer differently than those apps would. The last line shows
Dialog's version number, which also appears at the top of Settings.

## The top bar

- **Dialog** and the Socrates medallion: click either to show Dialog's version number in
  small type under the name; click again to hide it. (Settings shows it too.)
- **This conversation:** what its replies have cost, as reported by OpenRouter.
  OpenRouter's 5.5% fee on credit purchases comes on top.
- **Credit left** (only with a management key): your account's remaining credit, across
  all your keys. Hover for credit bought and used; click it to open OpenRouter's Credits
  page in a new tab, where you can add more.
- **This month:** what this API key has spent in the current calendar month. Months begin
  at midnight UTC. Hover for the key's all-time spending and its limit.
- **Save All** (or **Save Selected**), **Resume…** (only while the conversation is empty),
  **New conversation**, **Settings**: see below.

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
  Sleeping participants' folded cards stay at the end and have no handle.
- **Name**, at the top of the card, in the seat's color. Click it to rename. The name is
  what the others see ("Skeptic says: …") and what appears in the margin of the
  conversation. The logo of the model's maker comes just after the name (see The logos,
  below).
- **+ copy** adds another seat with the same model and settings, a new name ("Claude 2")
  and a darker shade of the color, without the role.
- **×** removes the seat. Its earlier contributions stay in the conversation.
- **The model button** shows the model's name and opens the model picker, a list of every
  OpenRouter model with its price (dollars per million tokens, input / output), plus
  LM Studio's models if you use LM Studio (see Models on this computer, below):
  - Type a few words ("opus", "gemini pro") to narrow the list; the current model is
    marked "(current)".
  - **Sort**, beside the search box, puts the list in order by name, or by input or output
    price, lowest or highest first. Models at the same price are in name order. Routers,
    which pass each request to a model they choose and so have no fixed price, are listed
    with the price "varies" and come last either way. Dialog remembers the order you chose.
  - Click a model, or use ↑ ↓ (Page Up / Page Down to jump) and Return.
  - Escape, Cancel, or a click outside the list closes it without changing anything.
  - Any model id can be typed in full (it contains a "/"); a "Use … as typed" row appears.
  - The list comes from OpenRouter and/or LM Studio. LM Studio's part is fetched each time
    you open the picker. Of OpenRouter's, Dialog keeps a copy and gets a new one when its
    copy is more than 12 hours old: when the page opens, and when you open the picker (even
    if the page has been open all along). The line under the list says how old the copy is ("from
    OpenRouter's list as of 15:28 today").
  - **Refresh list**, beside Cancel, gets a new list at once: use it for a model that has
    only just appeared. While the new list is on its way the button reads "Refreshing…" and
    the old list stays; your search and the highlighted model stay too. If the new list
    can't be fetched, the line under the list says why, and the old list stays.
  - Dialog always asks OpenRouter itself for the list, never a copy the browser kept from an
    earlier visit.
- Under the button: the model's **id and price**, or a warning if the id isn't in
  OpenRouter's current list. For an id that always follows a family's newest model (it
  begins with "\~", such as "\~deepseek/deepseek-flash-latest"), the id shown is that of the
  model it stands for now, such as "deepseek/deepseek-v4.1-flash-1017"; the "\~" name is on
  the model button above it. On a Mac, pointing at the id shows the "\~" id too.
- **The logos** of the models' makers (Anthropic, OpenAI, Google and so on) sit on each
  card's top line, just after the seat's name, folded cards included. They are the ones
  OpenRouter shows beside each model on its own pages, loaded
  from the same places: OpenRouter's site, or for some makers (xAI, Z.ai, Xiaomi, NVIDIA,
  Amazon, MiniMax, StepFun) Google's service for a website's icon. Dialog knows the logos of
  about twenty makers; for any other, or if a logo doesn't load, the card shows the maker's
  initial in a small square instead.
- **Web search and page reading** are always on; there is nothing to set (see Searching
  and reading web pages, below). If the model can't use tools, the card says "Can't use
  tools, so no web search or page reading". LM Studio models can't use the web.
- **Thinking** offers exactly the levels the chosen model lists on its OpenRouter page,
  highest first, with the model's own default marked. Models with no thinking setting show
  "not adjustable". Thinking is billed as output, whether or not you get to read it (see
  Reading the thinking, under Talking).
- **Role** opens a box for that participant's standing instructions, e.g. "argue the
  skeptic's side". It shows "(set)" or "(none)". Use the role to give the participant a
  personality, a perspective or a job description.
- **Sleep**, beside Thinking, benches the participant for a while without removing it.
  Its card folds up to just its name, its maker's logo and the Sleep box, and moves to the
  end of the list.
  While asleep it sits out "team" rounds and isn't the one Return asks when your message
  names no one. It still replies if you name it at the end of your message, and stays in
  the To menu for private messages. It keeps its place in the order: untick Sleep and the
  card unfolds where it was. (If you move other cards meanwhile, it comes back among the
  same neighbors.) Sleeping participants still appear in the participant list every seat
  is given, since they may be asked again.
- **Speak** asks the participant to reply now. Only one participant speaks at a time,
  except in an independent round, when all of them do at once (see Talking, below). While a
  participant speaks, its card is outlined, the Speak buttons wait, and its **Stop** button
  ends its reply early.
- The participant's **cost so far** in this conversation, at the bottom right of the card.

## Talking

**Words at the end of your message** tell Dialog who will reply when you press Return.
Dialog takes them off before anyone sees your message, and marks it with a stage direction
instead, such as "(to Grok)". Each is explained in full below.

| End your message with      | Example                             | What happens                                                                                                                                               |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a name                     | "…what do you think, Grok?"         | Grok replies.                                                                                                                                              |
| several names              | "…, Gemini and Claude?"             | Each replies once, in that order, seeing the replies before it.                                                                                            |
| names and "independently"  | "…, Claude and Grok, independently" | They reply at once, without seeing each other's replies.                                                                                                   |
| "team"                     | "…what do you think, team?"         | Every awake participant replies once, in turn.                                                                                                             |
| "team" and "independently" | "…team, independently"              | Every awake participant replies at once, without seeing the others' replies.                                                                               |
| "privately"                | "…, Grok, privately"                | The same as without "privately", but private: only the participants named see your message and their replies. With no name, it goes to whoever spoke last. |
| "only"                     | "…, Grok only"                      | The same as "privately", but only right after a name, a list of names or "team".                                                                           |

"parallel" and "in parallel" mean the same as "independently", and can come before or after
the names or "team". Without any of these endings, Return asks whoever spoke last. ⌘↩ never
asks anyone: it just adds your message (privately, if it ends with "privately" or "only").

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
  - **A list of names** at the end asks just those participants, once each, in the order
    you typed them: "…what do you think, Gemini and Claude?" has Gemini reply, then
    Claude (who sees Gemini's reply). Separate the names with spaces, commas, "and", "&",
    "+" or "/". Add "independently" (or "parallel", or "in parallel") before or after the
    list ("…, Claude and Grok, independently") and they all reply at once, each without
    seeing the others' replies from that turn (see "…independently, team", below).
    A name given twice counts once. Your message is marked "(to Gemini and Claude, in
    turn)".
  - Otherwise the participant who spoke last replies, unless it has been put to sleep (see
    Sleep, above); then the last awake one to speak does. Only the open conversation
    counts; a private exchange doesn't change who is next.
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
  independently)", and the participants are told that in plain words instead. They go
  around the table in card order, starting with the one after the last speaker, so nobody
  speaks twice in a row. Each sees the replies before it. The note beside the button says
  how many and who goes first ("↩ adds, then all 5 reply in turn, Claude first", or "the
  3 awake" when some are asleep); hover over it for the whole order.
  - **"…independently, team"** (or "…team, independently") has each reply without seeing
    the others' replies from that round, which avoids everyone following whoever answered
    first. **"parallel"** or **"in parallel"** means the same ("…in parallel, team",
    "…team, parallel"). Those replies are marked "(answering independently)", here and in
    saved files. Afterwards everyone sees them all, as usual.
  - **An independent round runs all at once.** Since no participant waits for another's
    reply, every request goes out together. The replies take their places in the
    conversation straight away, in the round's order, each showing "waiting for …" until
    something arrives, and then fill in side by side; nothing moves while you read. The
    round takes about as long as its slowest participant, not all of them one after
    another. Nobody goes first, so the note beside the button says "↩ adds, then all 5
    reply independently, at once"; hover over it for the order the replies will appear in.
  - Because "in parallel" is ordinary English too, a question that ends "…can these run in
    parallel, team?" also starts an independent round, and is sent as "…can these run?".
    The note beside the button shows this before you press Return; reword the question if
    that isn't what you meant.
  - Typing slips are forgiven ("tema", "taem", "teamm", "independantly", "idnependently",
    "paralel", "paralell", "parralel"), but real words a slip or two away don't count:
    "…in the long term." doesn't start a round, nor do "tea", "steam", "teams", "tear",
    "beam" and the like, and "parallels", "parable" and "parallax" aren't "parallel". A
    participant's name at the end still wins: "…what about you, Grok?" asks Grok alone.
  - Sleeping participants sit rounds out, including one put to sleep while a round is
    running (if you'd named it in a list, it still replies). If everyone is asleep,
    "…, team" just adds your message, without "team", and nobody replies.
  - Participants without a model are skipped. While a round runs, the Speak buttons wait.
    In a round taken in turn, **Stop** ends the reply under way and the rest of the round;
    in an independent round, each card's **Stop** ends only that participant's reply, and
    the others go on. A failed reply is skipped and the round goes on. A round costs about
    as much as all the participants' replies together.
- **Speak also adds whatever you've typed and attached** before the participant replies, so
  one press both says something and asks someone to answer. To have one participant
  respond to another, press the Speak button of the one who should respond, with the box
  empty.
- **To: Privately: \<name\>** sends a message to that participant only. The box turns
  parchment-colored and the button reads "Send privately to \<name\>"; Return and ⌘↩ do the
  same. The participant answers at once. Both entries are set on parchment and marked like stage directions,
  "(privately, to Grok)" and "(privately, to John Doe)", and no other participant ever sees
  them. The participant itself remembers them, as it would in its own chat window.
- **"…, privately"** as the very last word of your message does the same without the To
  menu: "What do you really think, Grok, privately?" goes to Grok alone, and Grok answers.
  Like a name, the word is for Dialog and comes off your message. While your message ends
  with it, the box turns parchment-colored, the button reads **Add privately**, and the
  note beside it says who will reply ("↩ sends privately; Grok replies · ⌘↩ just adds it
  privately").
  - **Whom it goes to** follows the usual rules for Return: the names at the end (before
    "privately"), or, if you name no one, the participant who spoke last. Press a card's
    **Speak** instead and, if you named no one, it goes to that participant.
  - **Several names** make a private group: "…, Claude and Grok, privately" goes to Claude
    and Grok, who reply in turn (or at once, with "independently"). Each sees your message
    and the other's reply; nobody else ever sees any of it. The entries are marked
    "(privately, to Claude and Grok, in turn)", "(privately, to Bill and Grok)" and so on.
    "…, team, privately" goes to every participant who is awake; sleeping ones never see
    it.
  - **"only"** means the same as "privately", but only right after a name, a list of names
    or "team": "…what do you really think, Grok only?" goes to Grok alone. Anywhere else it
    is just a word, so "Answer in one sentence only" is an ordinary message.
  - **⌘↩ or Add privately** puts the message in privately without asking anyone to reply.
  - **Nothing goes in for everyone by mistake.** If no one has spoken yet and you name no
    one, the note says "Say whom it's for" and the button waits; while replies are still
    arriving, it says to wait until they've finished.
  - Typing slips are forgiven ("privatly", "privatley"), but "private" doesn't count, and
    neither does "privately" anywhere but at the very end: "We spoke privately, Grok" asks
    Grok openly.
- **Replies appear as they are written.** "waiting for Claude…" (or whoever is replying)
  shows until something arrives, counting the time waited from the first second ("waiting
  for Claude… 12 s", then "… 1 min 5 s"): the request may still be on its way, queued at the
  host, or searching the web.
  Replies are formatted from Markdown (headings, lists, tables, code); links open in a new
  tab. If a model begins its reply with its own label ("Claude says:"), Dialog removes it.
- **The conversation follows a reply as it comes in** while you're at the bottom. Scroll
  back to read something earlier and it stays where you put it: the reply goes on arriving
  below, out of view, until you scroll back down to the bottom, which follows it again.
  Adding a message of your own takes you to the bottom.
- **Reading the thinking.** Above a reply that came with its thinking is a folded-up
  **Thinking** line: click it to read the thinking, and again to fold it away. It appears
  as soon as the thinking starts to arrive, and reads "Thinking…" until the reply itself
  begins; then "Thinking", complete. Open, it fills in as the model thinks, and stays open
  while you carry on. How much there is depends on the
  model: some send all their thinking, many (Claude and Gemini, for instance) a summary,
  and some (OpenAI's) none, and then there is no Thinking line. The thinking is kept only
  while the page is open: it isn't stored in the browser or put in saved conversations, so
  reloading the page drops it. The participants never see anyone's thinking.
- **Mathematics** written in LaTeX, as models often write it, is shown as mathematics once
  the reply is complete (while it arrives, you see the LaTeX). A formula between `$$` and
  `$$`, or `\[` and `\]`, stands on its own line; one between `$` and `$`, or `\(` and
  `\)`, sits within the sentence. Your own messages work the same way. Prices are left
  alone: a `$` counts as math only when the next character isn't a space, and the closing
  one comes right after the formula and isn't followed by a digit, so "$5 and $10" stays
  money. Math inside code is left as written. LaTeX that can't be read is shown as written,
  in red; point at it for the reason. Saved conversations show the math too. The
  participants themselves receive the LaTeX, as written.
- **Each turn** shows, in the margin, a tick box for saving (see Saving, below), the time
  it began and the speaker's name, and under a reply's name its **cost** and **speed**
  (below) on two lines. After the text come any **sources**, and "stopped early" if you
  stopped it.
- **Tap (or click) a reply's cost and speed** for the full particulars below the text: the
  exact model that answered (for a "\~" id, the model it stood for then) and the thinking
  level it was given; the **host**, the company whose servers ran the model (OpenRouter
  often has several for one model: for Qwen, say, Alibaba itself or an independent host);
  the cost with its token counts, including how much was re-read at the discount and how
  much was stored for re-reading; its **web use** (see Searching and reading web pages,
  below); and the speed's breakdown. Below a long reply, the
  conversation scrolls just far enough to bring them into view. Tap either again to hide
  them. Particulars that are open when you save are saved in full too.
- **The host** usually arrives with the reply. If it doesn't, Dialog asks OpenRouter the
  first time you open that reply's particulars ("Host: looking up…"), then keeps the answer.
  If OpenRouter can't say yet (just after a reply, its record may not
  be ready), the line is left out and Dialog asks again the next time you open them. It
  can only look up replies made with the same OpenRouter account as your key, and only
  replies from Dialog 2.2 on. Models in LM Studio have no host line.
  Nothing needs hovering, so this works on an iPad too. (On a Mac, pointing at a
  participant's name also shows the model and thinking level.)
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
  OpenRouter's current list" (once Dialog's copy of the list is refreshed: within 12 hours,
  or at once with **Refresh list** in the model picker),
  and pressing its Speak button gives a failed reply that says the model is no longer
  listed and to choose another with the seat's model button. Nothing else is affected. The
  seat keeps its name, role and earlier turns; its new model will take those earlier
  replies as its own. Model ids beginning with "\~" (such as "\~google/gemini-pro-latest")
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
- **Which searches and pages a reply used** appears in its particulars, as its model's host
  reports them: "Web: 2 searches", or "Web: 1 search and 1 page read". Some hosts (Claude's,
  for instance) count only searches, so a page read doesn't always show. Dialog can't tell
  while it happens that a participant is searching or reading: the reply simply pauses.
  When the reply's text then goes on after a finished sentence, Dialog starts a new
  paragraph, so the two parts don't run together.
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

In each reply's margin, under its cost, is its speed in tokens per second: the tokens the model
wrote (its hidden thinking included, since that is billed and takes time) divided by the
seconds from pressing Speak to the last word. That time includes thinking, any web searches
and network delay, so it measures how fast the participant answers you, not raw model
speed. Tap it for the breakdown: how long until the first words appeared, and how
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
  text with its free converter. Models in LM Studio get no PDFs: they are told a PDF was
  shared, so attach the text instead (copy it into a text file) if they should read it (Dialog asks for that one explicitly, because the paid
  default costs $2 per 1,000 pages and a PDF is re-sent every turn).
- Word, Pages, Excel and similar files can't be read; Dialog says so and suggests exporting
  them as PDF. Other refusals (a file too large, a type Dialog can't read) appear above the
  input box.
- What some models take in, per OpenRouter's model list on 2026 Oct 07. Text files work
  with every model, since they arrive as ordinary text. Dialog checks OpenRouter's current
  list each time, so it adapts if this changes.

  | Model                                           | Images                       | PDFs                            |
  | ----------------------------------------------- | ---------------------------- | ------------------------------- |
  | Claude Opus 5.5                                 | yes                          | read by the model itself        |
  | GPT-6 Astra                                     | yes                          | read by the model itself        |
  | Gemini Pro (latest; now Gemini 3.1 Pro Preview) | yes                          | read by the model itself        |
  | Grok 4.7                                        | yes                          | read by the model itself        |
  | DeepSeek Pro (latest; now DeepSeek V4 Pro 0813) | no; told an image was shared | converted to text by OpenRouter |
  | Qwen 3.8 Max, Max Prime, Omni Flash             | yes                          | converted to text by OpenRouter |

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

## Files the participants make

A participant can hand you a file: a document, a table, a drawing, a small web page. Ask for
one ("…put that in a Markdown file, Claude"), or a participant may offer one when a file is
clearly the best way to deliver something. Dialog tells every participant how (see House
rules, under Settings).

- **Kinds:** Markdown (`.md`), plain text (`.txt`, or another text format such as `.csv`),
  drawings (`.svg`) and web pages (`.html`). A web page can carry its own styles and
  scripts: a calculator, a chart, a small game.
- **Each file is a card** under the reply it came in: its name, kind and size, a small
  picture of a drawing, and three buttons.
  - **Open** shows it in a new tab: Markdown formatted, text as written, a drawing full size,
    a web page running. If nothing opens, allow pop-up windows for the page.
  - **Save…** puts it on your computer (see Where files go, under Saving). A web page goes
    through the pretty-printer first (see Laid out for reading, under Saving); other files
    are saved exactly as written.
  - **×** removes it. The card stays, struck out, and no participant sees the file from
    then on. Save it first if you want to keep it.

  While a reply is arriving, it says which files are done and which one is being written.
  If a reply ends, or you stop it, before a file is finished, the card says the file may be
  incomplete.
- **A web page opens walled off from Dialog.** A page a model wrote could hold anything,
  including a script meant to read what Dialog keeps in your browser, your OpenRouter keys
  among it. So Open shows the page inside a *sandboxed* frame: the browser treats it as a
  separate site, with no way into Dialog's storage or the Dialog tab. Its scripts run, and
  it can load pictures or libraries from the web, but it can't reach Dialog. Drawings,
  Markdown and text open the same way, with no scripts allowed at all.
- **A saved web page has no such wall.** In Chrome, every page opened from a file on your
  computer shares one storage, Dialog's included. So view a participant's web page with
  Open, and double-click a saved copy only if you've read it, or trust it as you would any
  page downloaded from the web.
- **The others see the files.** A file goes to the other participants right after the
  text of its reply, in the same form as the files you attach, so anyone can comment on it
  or improve it. A file in a private reply stays private. To revise a file, a participant
  writes it again under the same name. The newer version then replaces the older one for
  everyone: the older card says "A later version replaces this one", and its contents are
  no longer sent.
- **Cost:** like a file you attach, a participant's file is re-read by every participant
  each time it speaks, until it is removed or replaced. A 20 KB web page is about 5,000
  tokens: about 2 cents a turn for Claude Opus 5.5 at full price, a tenth of a cent at the
  re-reading discount. Removing files nobody needs any more saves money.
- Files are stored in the browser like attached files (see Attaching files), and the
  saved conversation includes them: drawings as pictures, and every file's text in a section
  you click to open. A saved conversation never runs a web page; it shows its text.

## Saving and starting over

- **Save All** (top bar) saves the whole conversation as one web page, styled like Dialog
  and readable in any browser: participants with their models, thinking levels and roles;
  the first sentence of your About-you text, under your name; every turn, set as a dialogue,
  with private exchanges included and marked (and the other stage directions too: "(to
  Grok)", "(to everyone, in turn)", "(answering independently)"); attached images shown,
  attached text files tucked into a section you click to open, PDFs listed by name; the
  participants' files (see above); sources; each reply's cost and speed in the margin, as on
  screen, with the conversation's total at the end (and the full particulars below the
  text, for any reply whose particulars you have open).
  A reply given with a different model or thinking level from the one its seat has now (you
  changed it since, or removed the seat) is marked with the one it used. Failed replies are
  left out, and so is the participants' thinking. The file is named like "Dialog 2026 Oct 07 2205.html".
- **Save Selected:** tick the box beside any turns (yours or the participants'; the box is
  faint until you point at the turn) and the top-bar button becomes **Save Selected**. It
  saves just those turns, in order, and lists under Participants only those who speak in
  them; you appear there only if one of your own turns is ticked. The heading says how many
  turns were chosen, and the total at the end is for those turns. The file is named like
  "Dialog 2026 Oct 07 2205 selected.html". Ticks stay after saving, so you can adjust and
  save again; untick them all and the button is Save All again. Ticks are not remembered
  when the page closes, and New conversation clears them.
- **Resuming a saved conversation.** Either kind of file can be picked up again later, in
  this browser or another one. While the conversation is empty (as after **New
  conversation**), the top bar has a **Resume…** button beside Save All; press it and choose
  the file. The button goes away once the conversation starts. Dialog says when it was saved, how many turns it has and who takes part, and asks
  before going ahead. The conversation then comes back as it was when saved: every turn,
  private exchanges, attached files (PDFs included) and the participants' files, costs and
  speeds. The participants, the house rules, your name and About you are replaced with the
  ones saved with it, so everyone carries on as before. A file from Save Selected brings back
  only its turns, but every participant who was in the conversation, including those who
  don't speak in those turns. Your keys and the LM Studio address are never put in a saved
  file and stay as they are. Files saved before Dialog 2.1 can't be resumed, but can still
  be read by a browser.
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
- **Laid out for reading.** Every HTML file Dialog writes goes through a *pretty-printer*, a
  program that lays source text out for people to read (Dialog uses js-beautify): saved
  conversations, participants' web pages when you save them, and `index.html` and
  `README.html` themselves. Each element goes on its own line, indented two spaces, and long
  lines are broken at a space near 100 characters. Only the layout of the text changes: the
  page looks exactly the same in a browser, and text in preformatted blocks (such as the
  files in a saved conversation) is left as it was.
- **Copying into an email.** Select part of the conversation, or all of it with ⌘A, and
  copy (⌘C): what you paste into Mail (or any program that takes formatted text) looks as it
  does on screen, with each turn's time, name and stage direction in the margin and the
  participant's model under its name. Only the turns come along: none of the page's
  buttons, tick boxes, the Participants panel or the box you type in, and no costs or
  speeds. If the selection starts or ends partway through a turn, only the part you
  selected is copied. Thinking is included only if it is open on screen and selected.
  Copying a few words or paragraphs from within a single turn works as in any web page.
  Programs that take only plain text get each turn's time and name, the model, and the text.
- **New conversation** clears the conversation (save first). Participants and settings stay.
  To go back to a saved one, press **Resume…** in the top bar.
- Between visits, Dialog remembers the conversation, the participants and your settings.

## Models on this computer (LM Studio)

Alongside OpenRouter's models, a participant can use a model running in
[LM Studio](https://lmstudio.ai) on your own computer. It costs nothing per reply, and its
messages never leave the computer. LM Studio participants and OpenRouter participants can
share one conversation; a conversation with only LM Studio participants needs no OpenRouter
key at all.

**Setting up:**

1. In LM Studio, download a model and load it.
2. Start LM Studio's server with **CORS** on. CORS is what lets a web page, such as Dialog,
   talk to the server. The surest way is in Terminal:
   `~/.lmstudio/bin/lms server start --cors`
   LM Studio's own caution applies: while CORS is on, any website you visit can use the
   server (only from browsers on this computer). Stop the server when you're done
   (`~/.lmstudio/bin/lms server stop`) or start it again without `--cors`.
3. In Dialog's Settings, click the **LM Studio server** box: it fills in the usual
   address, http://localhost:1234. If your server has another address, type it instead.
4. Press a seat's model button. LM Studio's chat models come first in the list, marked
   "(LM Studio)", with "loaded" beside any model loaded now; the line under the list says
   how many there are, or why LM Studio couldn't be reached. Choose one, and a new seat is
   named after the model ("Gemma 4 31B QAT"). A model not loaded yet is loaded by LM Studio
   when it is first asked, which can take a while.

**Which browser:**

- **Chrome** works with the online Dialog. The first time, Chrome asks whether the page may
  reach devices on your local network; allow it.
- **Safari** doesn't let the online Dialog (an https page) reach a server on this computer.
  It works when Dialog is opened from a copy of `index.html` on your disk (keep
  `README.html` beside it): double-click the copy. Safari keeps that copy's settings and
  conversation apart from the online page's, so you set it up again there (Save settings
  to a file and Restore from a file carry your setup across).

**What's different about an LM Studio participant:**

- **No cost** is shown: the reply's speed and token counts are, as for any reply.
- **No web search or page reading:** those are done by OpenRouter.
- **No thinking setting:** the card's Thinking menu is fixed at the model's own default.
  A model's thinking appears under the Thinking line when LM Studio sends it apart from
  the reply.
- **Images** go to models LM Studio lists as able to view them; others are told an image
  was shared. **PDFs** aren't sent (see Attaching files).
- **The conversation must fit the model's window.** LM Studio loads a model with a fixed
  context length (often 8,192 tokens, though many models support far more). A conversation
  longer than that fails with a message saying how many tokens it needs; in LM Studio, load
  the model again with a larger context length, or start a new conversation.
- If the card says the model **is not among LM Studio's models**, it was removed from
  LM Studio, or the id was typed wrongly. LM Studio answers such a request with whichever
  model it has loaded, so choose the model again.
- If Dialog **couldn't reach LM Studio**, check that the server is running and was started
  with CORS on, and that the address in Settings is right.

## Settings

- **OpenRouter API key**, with **Show** to check what you pasted.
- **OpenRouter management key (optional)**, to show your remaining credit; see Getting
  started.
- **LM Studio server (optional)**: the address of LM Studio's server on this computer,
  usually http://localhost:1234, for using its models; see Models on this computer
  (LM Studio). Leave it empty if you don't use LM Studio.
- **Your name**: what participants call you, and the name on your turns.
- **About you**: a few sentences every participant receives, on every turn, after the house
  rules (and Dialog's note on making files) and before its role.
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

  After the house rules, Dialog adds a short note of its own that you can't edit: how to
  make a file (see Files the participants make). It is part of how Dialog works, like the
  way messages are labeled, so editing the rules can't break it.

  When the default rules change in a new version of Dialog, a copy you never edited is
  updated to match. An edited copy is left alone, except that a default sentence that has
  since been reworded is updated where it still appears word for word.
- **Save settings to a file…** downloads your name, About you, the house rules and every
  participant (name, model, thinking level, role, color and whether it's asleep) as one small file, named like
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
instructions (house rules, the note on making files, About you, its role) and the whole
conversation as that seat sees it, and the model answers from scratch. What makes "Claude-Skeptic" different from
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
that already holds that seat's earlier text. Tap a reply's cost to see how much was
re-read at the discount and how much was stored.

## Where your data lives

The conversation, attached files, the participants' files, settings and your keys are kept in your browser's storage
for this page, on this computer only. The participants' thinking isn't kept: it goes when the page closes. Each browser keeps its own: open Dialog in Chrome after
using it in Safari and Chrome starts empty, with no key, participants or conversation. To
carry your setup across, use **Save settings to a file** in one and **Restore from a file**
in the other; to carry a conversation across, save it with **Save All** and resume it in
the other. A saved conversation holds its attached files in full, but never your keys. Messages go only to OpenRouter, which passes each one to the
model you chose. The management key, if you add one, goes only to OpenRouter's credit
check. A participant using a model in LM Studio is different: its messages go only to
LM Studio, on this computer, and never to OpenRouter. Drawing the seat cards' logos asks OpenRouter's site, and for a few makers Google's
icon service, for the logo; that request carries nothing of yours but your computer's
internet address and which logo it wants.

## Look and credits

The page is set like a printed dialogue: each speaker's name hangs in the left margin,
private exchanges are set on parchment and marked like stage directions. Controls use Optima
and the conversation uses Iowan Old Style, both built into macOS; on other systems similar
fonts stand in. Mathematics is drawn by the browser itself, in STIX Two Math (also built into
macOS); Temml turns the models' LaTeX into the browser's math markup. Dialog follows your system's light or dark appearance; in dark, the engraving is
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

| File                       | What it does                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `types.ts`                 | The data: seats, entries, settings                                                                               |
| `engine.ts`                | The rules: each seat's view of the conversation, house rules, files the participants make, seat names and colors |
| `export.ts`                | Saving the whole conversation, or the ticked turns, as an HTML page                                              |
| `pretty.ts`                | The pretty-printer every HTML file goes through                                                                  |
| `openrouter.ts`            | Talking to OpenRouter: streaming replies, costs, citations, model list, key and credit                           |
| `storage.ts`               | Saving to and loading from the browser's storage                                                                 |
| `attachments.ts`           | Reading dropped or picked files into attachments                                                                 |
| `makers.ts`                | Who made each model, and where its logo comes from                                                               |
| `main.ts`                  | The page: drawing everything and handling clicks                                                                 |
| `index.html`, `styles.css` | Page skeleton and appearance                                                                                     |
| `icons/`                   | The Socrates engraving and the welcome picture, medallion and tab icon made from it                              |

This guide is `README.md`; the build turns it into `README.html`, in Dialog's style.

To rebuild (needs Node.js): `npm install`, then `npm run build` (type-checks, then writes
`dist/index.html` and `dist/README.html`, both pretty-printed; the build stops if the
pretty-printer changed what the page's script or styles do), and `npm test` (unit tests,
a simulated run of the whole page against a fake OpenRouter, and a check that README.html
shows everything README.md says: Markdown would strike out text between two "\~" and drop
a word in angle brackets, so README.md writes them `\~` and `\<name\>`).
