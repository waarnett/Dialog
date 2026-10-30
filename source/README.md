# Dialog

A moderated group conversation between you and several AI models: Claude, ChatGPT, Gemini,
Grok, DeepSeek or any other model OpenRouter offers, and models running in LM Studio on your
own computer. You decide who speaks next. Every participant sees the same conversation,
except for private exchanges you have with one or more of them. Dialog is a single web page;
Safari and Chrome both work.

**Contents**

- [Getting started](#getting-started)
- [The top bar](#the-top-bar)
- [Participants](#participants)
- [Roles](#roles)
- [Talking](#talking)
- [Reading replies](#reading-replies)
- [Web search and reading pages](#web-search-and-reading-pages)
- [Files](#files)
- [Saving, restoring and tabs](#saving-restoring-and-tabs)
- [Settings](#settings)
- [Models on this computer (LM Studio)](#models-on-this-computer-lm-studio)
- [How it works, and what it costs](#how-it-works-and-what-it-costs)
- [Where your data lives](#where-your-data-lives)
- [Credits](#credits)

## Getting started

1. **Get an OpenRouter API key.** At openrouter.ai, sign in, add a little credit (Credits
   page), then create a key (Keys page). Give the key a **credit limit**: it caps what Dialog
   can ever spend, and can reset daily, weekly or monthly.
2. **Open Dialog**: online at https://waarnett.github.io/Dialog/, or double-click a copy of
   `index.html` (keep `README.html` beside it).
3. Click **Settings**, paste the key, and put in **your name** and, if you like, a few
   sentences **about you**. Look over the **house rules**, the instructions every participant
   gets. Click **Done**.
4. **Add participants.** Under Participants, on the right, press **+ Add a seat** and choose a
   model. Add as many as you like, including several of the same model, and give each one a
   **role** if you want it to play a particular part (see Roles, below).
5. **Talk.** Type a message and end it with a name or with "team": "What's the strongest
   objection to this, team?" (see Talking, below).

**No OpenRouter account?** With models in LM Studio on your own computer you can do without
one: leave the key empty and see Models on this computer (LM Studio), below.

Until the conversation starts, a welcome screen lists the steps still to do, links to this
guide and shows Dialog's version number.

## The top bar

- **Dialog** and the Socrates medallion: click either once to show the version number, a
  second time for a link to this guide in its place, and a third time to hide it again. This
  guide shows the version number under its own Dialog at the top.
- **This conversation:** what its replies have cost, as OpenRouter reports it. OpenRouter's
  5.5% fee on credit purchases comes on top.
- **Credit left** (only with a management key; see Settings): your account's remaining
  credit. Hover for credit bought and used; click to open OpenRouter's Credits page.
- **This month:** what this key has spent since the 1st (months begin at midnight UTC).
  Hover for its all-time spending and its limit.
- **Save All** or **Save Selected**, **Restore…** (only while the conversation is empty),
  **New conversation** and **Settings**: see Saving, restoring and tabs, and Settings.

A **notice** under the top bar says when something needs attention: no API key yet, or the
browser refusing to let Dialog save (the conversation would then be lost when the page
closes).

## Participants

Each participant (a "seat") has a card on the right:

- **Name**, in the seat's color: click it to rename. It is what the others see ("Skeptic
  says: …") and what appears in the conversation's margin. The logo of the model's maker
  follows it.
- **The model button** opens the model picker: every OpenRouter model with its price
  (dollars per million tokens, input / output), plus LM Studio's models if you use them.
  Type a few words ("opus", "gemini pro") to narrow the list; **Sort** orders it by name or
  price; click a model or use the arrow keys and Return. A full model id (containing a "/")
  can be typed too. **Refresh list** fetches the newest list at once, for a model that has
  only just appeared; the line under the list says how old it is.
- Under the button, the model's **id and price**, or a warning that the id is no longer in
  OpenRouter's list. Ids beginning with "\~" (such as "\~google/gemini-pro-latest") always
  follow a family's newest model, and the id shown is the one they stand for now.
- **Thinking**: how hard the model thinks before replying, offering exactly the levels the
  model supports, with its default marked. Thinking is billed as output, whether or not you
  get to read it.
- **Role**: the participant's standing instructions; see Roles, below. It shows "(set)" or
  "(none)".
- **Sleep** benches the participant without removing it. Its card folds up and moves to the
  end of the list. A sleeping participant sits out "team" rounds and isn't the one Return
  asks by default, but still replies when you name it. Untick Sleep and it returns to its
  place.
- **Speak** asks the participant to reply now; **Stop** ends its reply early. While it
  speaks, its card is outlined.
- **⠿** (left of the name) moves the card: drag it, or click it and press ↑ or ↓. The order
  is the order of the To menu and of "team" rounds.
- **+ copy** adds another seat with the same model and settings, but no role. **×** removes
  the seat; its earlier contributions stay in the conversation.
- The participant's **cost so far** is at the bottom right of the card.

Web search and page reading are always on for models that can use them; the card says so
when a model can't.

## Roles

A role turns a model into a particular participant. "Claude" and "Claude-Skeptic" can run
the same model; what makes them different is mostly the role.

**What a role is.** Any text you write in the seat's Role box. That participant receives it
every time it speaks, after the house rules and About you, as "Your role in this
conversation". Because it comes last, a role can override the house rules for that one
participant.

**What a role can do:**

- **Give a point of view or a position:** "Argue the skeptic's side. Find the weakest step in
  each argument and press on it." Two seats with opposite positions make a debate.
- **Give a job:** fact-checker, editor, summarizer, devil's advocate, note-taker. "When I
  ask, summarize where the group agrees, where it disagrees and what is still open, in under
  200 words."
- **Give a manner or a voice:** blunt, patient, Socratic (answer with questions), a teacher
  explaining to a beginner, a historian who separates what is known from what is guessed.
- **Set the form of its replies:** length, structure, language, level of detail.
- **Override a house rule** for this participant only: "For this role, ignore the rule on
  length: write as much as the question needs." Or "Don't give confidence percentages."
- **Narrow its attention:** "Look only at the numbers: check every figure anyone gives."

**What a role can't do:**

- **Add knowledge or abilities.** "You are the world's leading expert on X" adds no
  expertise; it mostly makes the model sound more sure of itself. Say instead what to focus
  on and what to check.
- **Tell the others anything.** A role is seen only by its own participant. The others see
  its name and model, and what it says. If they should know its part, say so in a message, or
  let the name tell them ("Skeptic").
- **Make it speak up on its own,** or decide who goes next: you do, every turn.
- **Show it what it can't see:** other participants' private exchanges, their thinking, or
  earlier conversations. Each participant knows only the conversation as it sees it.
- **Change how Dialog works:** how messages are labeled, who sees what, or how files are
  made.
- **Get past the model's own limits.** What its maker trained it to refuse, it still refuses.
- **Guarantee obedience.** In a long conversation, or when a role pulls against the model's
  habits, a participant can drift out of it. Remind it in a message, or make the role
  plainer and firmer.

**Changing a role** takes effect on the participant's next turn; its earlier replies stay
as they were. Since the role is part of what the participant re-reads every turn, its next
turn reads the whole conversation at full price once (see The re-reading discount, below).

Roles are saved with the conversation (Save All shows each participant's role) and with the
settings (Save settings to a file).

**Role, house rules or About you?** The house rules are for every participant; a role is for
one. About you is what everyone should know about you.

## Talking

### Adding a message and asking for a reply

- **Return** adds your message *and* asks a participant to reply, so a back-and-forth needs
  no clicking. The words at the end of your message say who (see below).
- **⌘↩** (Command-Return; Ctrl+Enter on other systems), or **Add to conversation**, only adds
  your message; nobody replies until you ask.
- **Shift-Return** or **Option-Return** starts a new line.
- **Speak**, on a card, adds whatever you've typed and attached, then has that participant
  reply. With the box empty, it has that participant respond to the conversation as it
  stands: the way to have one participant answer another.

The note beside the button always shows what Return will do ("↩ adds, then Grok replies ·
⌘↩ just adds") and changes as you type. With the box empty, Return does nothing, so a stray
keypress never pays for a reply.

### Choosing who replies

| End your message with      | Example                             | What happens                                                                 |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| a name                     | "…what do you think, Grok?"         | Grok replies.                                                                |
| several names              | "…, Gemini and Claude?"             | Each replies once, in that order, seeing the replies before it.              |
| names and "independently"  | "…, Claude and Grok, independently" | They reply at once, without seeing each other's replies.                     |
| "team"                     | "…what do you think, team?"         | Every awake participant replies once, in turn.                               |
| "team" and "independently" | "…team, independently"              | Every awake participant replies at once, without seeing the others' replies. |
| "privately"                | "…, Grok, privately"                | As without "privately", but only those named see it (see Private messages).  |
| "only"                     | "…, Grok only"                      | The same as "privately", right after a name, names or "team".                |
| nothing of these           | "…that's my view."                  | Whoever spoke last replies.                                                  |

- **These words are for Dialog, not part of your message.** Dialog takes them off ("What do
  you think, Grok?" becomes "What do you think?") and marks your message with a stage
  direction instead: "(to Grok)", "(to everyone, in turn)". The participants are told the
  same in plain words, so everyone knows whom you asked.
- **Only the last word counts,** so "I agree with Claude." asks Claude. Case and
  punctuation don't matter, and the longest matching name wins ("…Claude 2" asks Claude 2).
  Separate several names with spaces, commas, "and", "&", "+" or "/".
- **"parallel"** and **"in parallel"** mean the same as "independently", before or after the
  names. Since they are ordinary English too, "…can these run in parallel, team?" starts an
  independent round; the note beside the button shows this before you press Return.
- Small typing slips are forgiven ("tema", "independantly", "paralel", "privatly"), but
  real words that are close are not: "…in the long term." starts no round.
- With no name at the end, Return asks the last participant who spoke openly and is awake.
  If nobody has spoken yet, Return only adds your message.

### Rounds

- **In turn** ("…, team", or several names): the participants reply one after another, each
  seeing the replies before it. A "team" round goes in card order, starting after the last
  speaker, so nobody speaks twice in a row. Hover over the note beside the button for the
  order.
- **Independently** ("…team, independently"): every request goes out at once, and the
  replies fill in side by side, in their places. Nobody sees the others' replies from that
  round, which keeps everyone from following whoever answered first; afterwards, everyone
  sees them all. The round takes about as long as its slowest participant. Its replies are
  marked "(answering independently)".
- Sleeping participants sit "team" rounds out. If everyone is asleep, your message is just
  added.
- In a round taken in turn, **Stop** ends the current reply and the rest of the round. In an
  independent round, each card's Stop ends only that reply. A failed reply is skipped and
  the round goes on.
- A round costs about as much as all its replies together.

### Private messages

- **"…, privately"** at the very end of your message, or **To: Privately: \<name\>** in the
  menu beside the button, sends the message to that participant only, and it answers at
  once. While a message will be private, the box turns parchment-colored and the button
  reads "Add privately" or "Send privately to \<name\>".
- **Several names** make a private group: "…, Claude and Grok, privately" goes to both, who
  reply in turn (or at once, with "independently") and see each other's replies. "…, team,
  privately" goes to every awake participant; sleeping ones never see it.
- **"only"** works like "privately", but only right after a name, names or "team" ("…what do
  you really think, Grok only?"). Elsewhere it is an ordinary word: "Answer in one sentence
  only" is an ordinary message.
- With no name, a private message goes to whoever spoke last; with a card's **Speak**, to
  that card's participant. **⌘↩** adds it privately without asking for a reply.
- Private exchanges are set on parchment and marked "(privately, to Grok)". No one outside
  them ever sees them. The participants in them remember them, as they would in their own
  chat window, and a private exchange doesn't change who is next.
- **Nothing goes to everyone by mistake:** if Dialog can't tell whom a private message is
  for, the button waits and the note says why.

## Reading replies

- **Replies appear as they are written.** Until something arrives, "waiting for Claude… 12 s"
  shows; the request may be queued at the host or searching the web. Replies are formatted
  (headings, lists, tables, code), and links open in a new tab. A wide table uses the free
  space to the right of the text, so widening the window gives it more room; if it still
  doesn't fit, it scrolls sideways.
- **The page follows a reply** while you're at the bottom. Scroll up to read something
  earlier and it stays put until you scroll back down.
- **Thinking.** When a model sends its thinking, a folded **Thinking** line sits above its
  reply: click to read it. Some models send all of it, many (Claude, Gemini) a summary, and
  some (OpenAI's) none. Thinking is kept only while the page is open, is never saved, and no
  participant ever sees it.
- **Mathematics** in LaTeX, as models often write it, is shown as mathematics once the reply
  is complete. Prices such as "$5 and $10" stay money. LaTeX that can't be read is shown in
  red; point at it for the reason.
- **The margin** of each turn shows a tick box for saving, the time, the speaker's name and,
  for a reply, its **cost** and **speed**. After the text come any **sources** used, and
  "stopped early" if you stopped it.
- **Participants see the times too:** every turn reaches them with the time it began (the
  date as well on the first turn of each day), their own earlier replies included, so you
  can point one to a turn by its time ("what you said at 17:12").
- **Click a reply's cost or speed** for its particulars: the exact model that answered and
  its thinking level, the **host** (the company whose servers ran it), the cost table and the
  speed's breakdown. Click again to hide them.
- **The cost table** splits the cost into reading (the conversation it was given, including
  how much was re-read at the discount and how much was stored for re-reading), writing
  (including thinking) and, when it used the web, searches and pages read. OpenRouter
  reports the total; when it doesn't report the parts, Dialog works them out from the
  model's listed prices and marks them "about". Amounts are to the cent.
- **Speed** is the tokens the model wrote (thinking included) per second, from pressing
  Speak to the last word. It includes thinking, web searches and network delay, so it
  measures how fast the participant answers you. The particulars also show how long the
  first words took, and how fast the text came after that.
- **× on a turn** (it appears when you hover) removes it, so no participant sees it again.
- **A stopped reply** keeps what arrived, and the others see it.
- **When a reply fails**, Dialog shows OpenRouter's message and whatever details it sent
  (which host failed, the request id). **Try again** replaces it with a fresh attempt. Failed
  replies are never shown to any participant.
- **When a model is withdrawn** from OpenRouter, its card says so and its replies fail; choose
  another model with the seat's model button. The seat keeps its name, role and earlier
  turns. Ids beginning with "\~" follow the newest version and don't go away.

## Web search and reading pages

Every participant whose model can use tools may **search the web** and **read web pages**,
deciding for itself when. OpenRouter does both on its behalf; there is nothing to set.

- **A search** costs about 1 to 3 cents. Claude and some others stop at 10 searches a reply.
  Sources used are listed under the reply.
- **Reading a page:** a participant can read any web page or online PDF whose address comes
  up in the conversation. It costs very little, plus the page's text at the model's input
  price, which for a long page and an expensive model can be 10 to 30 cents.
- While a participant searches or reads, its reply simply pauses. The cost table shows how
  many searches and pages a reply used.
- **Only the reader sees the page;** the others see what it says about it. Each reading is
  paid once, which is usually far cheaper than attaching the page as a file, since an
  attached file is re-read by every participant every turn. Attach it instead (save it as a
  PDF and drag it in) when everyone should work from the same copy, or when a site won't let
  OpenRouter in.

## Files

### Attaching files

Drag files onto the conversation, or click **Attach…**. They wait above the input box (×
drops one) and go out with your next message, privately if the message is private.

- **Text files** (Markdown, plain text, CSV, code and the like) go to every model as text.
  In the conversation, click the triangle by a text file's name to see what's in it (and
  again to fold it away), as in a saved conversation.
- **A conversation saved by Dialog** (Save All or Save Selected) goes in as just its turns,
  as plain text, named "… (transcript).txt": each turn's time (with the date on the first
  turn of each day), speaker and model, private exchanges marked as private, and the names
  of any files that were attached or made, but not the files themselves. That is far smaller than the saved page, which also holds its
  appearance and the data Restore… uses. To carry on with the conversation itself, use
  Restore… instead.
- **Images** (PNG, JPEG, WebP, GIF) are scaled down if large. A model that can't view images
  is told one was shared. A model can misread an image: to check, ask about a detail only
  the picture shows.
- **PDFs** go to models that read them themselves; for others, OpenRouter converts them to
  text free. Models in LM Studio get no PDFs: attach the text instead.
- **Word, Pages, Excel** and similar files can't be read; export them as PDF.
- **Cost:** an attached file is re-read by every participant every time it speaks. Text files
  show their size in tokens, and Dialog asks before attaching one over 50,000 tokens.
- Browsers give a page only a few megabytes of storage, so a very large file may be marked
  "not saved": it lasts until the page closes. Removing its turn frees the space.

### Files the participants make

A participant can hand you a file: a document, a table, a drawing, a small web page (a
calculator, a chart, a game). Ask for one ("…put that in a Markdown file, Claude"), or a
participant may offer one.

- **Kinds:** Markdown (`.md`), plain text (`.txt`, `.csv` and the like), drawings (`.svg`)
  and web pages (`.html`).
- **Each file is a card** under its reply, with **Open** (in a new tab: allow pop-ups if
  nothing opens), **Save…** and **×** (remove it, so no participant sees it again).
- **The others see the files,** and can comment on them or improve them. A participant
  revises a file by writing it again under the same name; the newer version replaces the
  older one for everyone. A file in a private reply stays private.
- **Cost:** like an attached file, it is re-read by every participant every turn until it is
  removed or replaced. Removing files nobody needs saves money.
- **Safety:** a web page a model wrote could hold anything, so **Open** shows it walled off
  from Dialog, with no way to reach your keys or your conversation. A **saved** copy has no
  such wall: open it by double-clicking only if you've read it or trust it as you would any
  download.

## Saving, restoring and tabs

- **Save All** saves the whole conversation as one web page, readable in any browser:
  the participants with their models, thinking levels and roles; every turn with its time
  (the date as well on the first turn of each day), private exchanges included and marked; attached images and files; the participants' files;
  sources; and each reply's cost and speed. Failed replies and thinking are left out.
- **Save Selected:** tick the box beside some turns (it shows when you point at a turn) and
  the button becomes Save Selected, which saves just those turns.
- **Restore…** brings a conversation back. It appears in the top bar while the conversation
  is empty (after New conversation, say) and lists, newest first, one line each with when it
  was saved and the first sentence of your first message:
  - **the last 25 conversations, kept in this browser**, a safety net for the ones you didn't
    save. Dialog keeps them with their files, updating each one as it goes, so a conversation
    survives closing its tab, quitting the browser or pressing New conversation. The **×** at
    the end of one deletes it from the browser, after asking. It's a net, not an archive:
    clearing your browser's website data removes them, and Safari removes them by itself if
    you don't open Dialog for about a week of using Safari (unless Dialog is added to the Dock
    or Home Screen, see below). Save anything you want to keep.
  - **the conversations in the files and folders you add** with **Add from…** at the foot of
    the list: a conversation saved with Save All or Save Selected, or a folder of them (in a
    folder, only the conversations in the folder itself are listed, not in folders inside it).
    Each folder or file you add joins those already listed, and they are all read again each
    time Restore… opens. In Safari you can add a folder or a single file; Safari forgets them
    when the page closes, and when it reads a folder again it sees only the files that were
    there when you added it, not conversations saved into it since (add the folder again for
    those). In Chrome you add folders, not single files; its folder chooser opens
    where you last saved, and Chrome remembers the folders you add: from then on they are
    read every time, new conversations included, after Chrome asks once a visit whether
    Dialog may look in them.

  The **↑** and **↓** keys move through the list; **Return** chooses. Dialog asks before
  resuming one; **Cancel** takes you back to the list. Choose one and carry on where it left
  off. Everything comes back as it was, including the participants, house
  rules, your name and About you. Your keys are never in a saved conversation, so yours stay.
- **Where files go:** Chrome lets you choose the folder and name. Safari saves to Downloads,
  unless you set Safari Settings › General › File download location to "Ask for each
  download".
- **Copying into an email:** select part of the conversation (or all of it with ⌘A), copy and
  paste into Mail: it looks as it does on screen, without buttons, costs or speeds.
- **New conversation** clears the conversation; participants and settings stay. Save first if
  you want to keep it. **⌘-click** it (Ctrl-click on other systems) to start a new
  conversation in a new tab instead, leaving this one as it is.
- **Each tab is a conversation of its own,** with its own participants and settings. A new
  tab starts empty, with the participants and settings as you last changed them in any tab.
- A tab keeps its conversation when you reload it. **Closing the tab** (or quitting the
  browser) ends the conversation without asking; Restore… can still bring it back.
- **On an iPad or iPhone**, Dialog works the same in Safari. Adding it to the Home Screen
  (Share › Add to Home Screen), or on a Mac to the Dock (File › Add to Dock), gives it a
  window of its own and keeps the conversations kept for Restore… safe from Safari's one-week clean-up. It also keeps its
  own settings: bring yours across with Save settings to a file and Restore from a file.

## Settings

- **OpenRouter API key**, with **Show** to check what you pasted.
- **OpenRouter management key** (optional), used only to show your remaining credit in the
  top bar. Create one at openrouter.ai/settings/management-keys, with an expiration date. Be
  aware that a management key can create new keys: someone who got hold of it could spend
  your remaining credit.
- **LM Studio server** (optional): see Models on this computer, below.
- **Your name**: what the participants call you.
- **About you**: a few sentences every participant receives on every turn, after the house
  rules and before its role.
- **House rules**: the instructions every participant receives. The defaults explain how the
  conversation works and ask for brief, honest, careful contributions: no flattery,
  confidence given as a percentage, alternatives shown with the evidence against them, and
  a qualified answer preferred to a confident mistake. Edit freely; **Restore default
  rules** undoes your edits. These placeholders are filled in for each participant:
  **{name}** its name, **{humanName}** your name, **{participants}** everyone present with
  their models, **{date}** today's date with your offset from UTC ("2026 Oct 27 (UTC-7)").
  After the rules Dialog adds a short note of its own, on how to make files, which you can't
  edit.
- **Save settings to a file…** saves your name, About you, the house rules and every
  participant (name, model, thinking level, role, color, asleep or not), as a backup or to
  move to another browser. **Include my keys in the saved file** adds your keys; keep such a
  file private.
- **Restore from a file…** reads such a file and asks before replacing your settings (and
  your keys, if the file has them). The conversation isn't changed.
- **Done**, Escape or a click outside closes Settings. Changes are kept as you type.

## Models on this computer (LM Studio)

A participant can use a model running in [LM Studio](https://lmstudio.ai) on your own
computer. It costs nothing, and its messages never leave the computer. LM Studio and
OpenRouter participants can share a conversation.

**Setting up:**

1. In LM Studio, download a model and load it.
2. Start LM Studio's server with **CORS** on, which lets a web page talk to it. In Terminal:
   `~/.lmstudio/bin/lms server start --cors`
   While CORS is on, any website you visit in this computer's browsers can use the server,
   so stop it when you're done: `~/.lmstudio/bin/lms server stop`.
3. In Settings, click the **LM Studio server** box: it fills in the usual address,
   http://localhost:1234.
4. Press a seat's model button: LM Studio's models come first, marked "(LM Studio)", with
   "loaded" beside those loaded now. One not loaded is loaded when first asked, which can
   take a while.

**Which browser:** Chrome works with the online Dialog; allow it to reach devices on your
local network when it asks. Safari works only with a copy of `index.html` opened from your
disk. That copy keeps its own settings; Save settings to a file and Restore from a file carry
them across.

**What's different:**

- No cost is shown, and there is no web search or page reading.
- The Thinking setting is fixed at the model's default.
- Images go only to models LM Studio lists as able to view them; PDFs aren't sent.
- **The conversation must fit the model's context length,** which LM Studio sets when it
  loads the model (often 8,192 tokens). A longer conversation fails with a message saying
  how many tokens it needs: load the model again with a larger context length.
- If Dialog **can't reach LM Studio**, check that the server is running with CORS on and that
  the address in Settings is right.

## How it works, and what it costs

**Each participant starts from scratch every turn.** The models keep no memory between
requests. Each time a participant speaks, Dialog sends its instructions (house rules, About
you, its role) and the whole conversation as that participant sees it. Two seats running
the same model share nothing but the transcript; each is told every participant's model.

**No hidden instructions from the makers' apps.** The ChatGPT, Claude and Gemini apps give
their models long hidden instructions about tone, formatting and safety. Here a model gets
only what Dialog sends, so it may sound noticeably different than in its maker's app.

**One key, many hosts.** Every request goes through your OpenRouter key; OpenRouter passes it
to a company that runs the model (Anthropic itself, say, or Amazon's or Google's cloud). The
model's makers never see your key.

**The re-reading discount.** Since every turn re-sends the whole conversation, the hosts
charge much less for text they've seen recently: for Claude Opus 5.5, a re-read costs a
twentieth of a fresh read. Dialog asks Claude for its 1-hour cache, which costs extra to fill
but soon pays for itself. Anything that changes a participant's instructions (its
role, the house rules, About you, the order of the cards) means its next turn reads
everything at full price once. Long conversations and attached files are what make a
conversation expensive; start a new one when the old one has served its purpose.

## Where your data lives

The conversation, files, settings and keys are kept in your browser, on this computer only.
Each tab keeps its own conversation until it closes; your latest settings are kept for the
next tab, and your last 25 conversations for Restore…. Each browser keeps its own: Chrome
doesn't see what Safari has. Use Save settings to a file and Save All to carry things across.

Messages go only to OpenRouter, which passes each to the model you chose, or, for an
LM Studio participant, only to LM Studio on this computer. The management key goes only to
OpenRouter's credit check. The makers' logos are fetched from OpenRouter's site (and for a
few makers from Google's icon service); those requests carry nothing of yours.

## Credits

The pictures all come from a wood engraving, signed W. Meyer, of an ancient marble bust of
Socrates. Mathematics is set with Temml. Dialog follows your system's light or dark
appearance; in a narrow window, the participants move below the conversation.
