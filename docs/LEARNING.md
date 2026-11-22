# Learning from research

Every research topic can teach you what it found. Open **Research → a topic → Learn**.

## Evidence you can trust

Research reads whatever the search providers return, so a topic can pull in a physics paper, a game wiki and a "portals are real" page side by side. Every source is now labelled with the kind of evidence it is (`src/research/SourceCredibility.ts`):

| Label | What it is | Stated as fact? |
|---|---|---|
| Academic research | Peer-reviewed papers, preprints, university and research-institute pages | yes |
| Reference & official docs | Encyclopedias, official documentation, standards, government | yes |
| News & science press | Journalism and established science/tech publications | yes |
| Practitioners, companies & forums | Q&A, forums, GitHub, blogs, company pages | useful, unreviewed |
| Speculative / unverified | Paranormal, esoteric, conspiracy, "is it real?" | no |
| Fiction & worldbuilding | Games, novels, tabletop, fan wikis | never |

Classification uses the source's address first (arXiv is academic whatever its title says) and its title only for unknown sites. The reports group findings by these labels — **Established evidence**, **From practitioners**, **Speculative claims**, **From fiction and worldbuilding** — with an evidence profile table, and the summary gets a **Reality check** whenever speculation or fiction is present. Regenerate a topic's documents to get the new format.

## Courses

**Plan my course** (pick beginner, intermediate or advanced) turns the findings into 5–8 lessons in learning order. Each lesson is written from the findings, strongest evidence first:

- **In short**: three points
- **The idea**: the explanation, with numbered citations
- **An example**
- **Key terms**
- **Fact check**: established vs theoretical vs fiction
- **Recap**
- **Read the sources**: every cited source, grouped by evidence type, with a quote of what it actually says

After the lesson come a 4-question quiz (75% completes the lesson) and flashcards, which are reviewed on a Leitner schedule (1, 3, 7, 16, 35 days).

**Study pack** is the whole course as one Markdown document (syllabus, lessons, questions, answers, flashcards and reading list) to download or print.

Writing happens on the PC's model and takes a few minutes per lesson. Lessons you open go ahead of research on the GPU; the next lesson is written while you read the current one. The tab polls and opens each lesson when it is ready.

## Talking to a topic

**Talk** answers from the findings with citations, and keeps evidence apart from fiction. Asking now returns at once and the answer appears as it is written. Before, the app waited on the request, and the Cloudflare tunnel cuts a request off after 100 seconds, so answers from the local model never arrived. Questions go ahead of research cycles on the GPU; if a call is already running, the app shows how many are ahead.

## Jarvis teaches too

Jarvis reaches all of this through the bridge. Actions: `learn.courses`, `learn.plan`, `learn.course`, `learn.next`, `learn.lesson`, `learn.answer`, `learn.cards`, `learn.review`, `learn.pack`, `research.chat`, `research.report`. In conversation:

- "teach me about …", "next lesson", "quiz me"
- "quiz answers: b, a, d, c" (marks the lesson you are on)
- "my flashcards", "my courses"

The lesson, quiz, marking or answer is posted into the chat. Every finished lesson is also filed in Second-Brain (his knowledge base), and **Send to Jarvis** in the Learn tab hands him the whole study pack.

The Jarvis side lives in his repo (`lib/jarvis/askBuilder.ts`: the TEACH pattern; `lib/jarvis/peers.ts`: `teachingLine`).

## API

```
GET  /api/learn                                 courses and progress
POST /api/learn/:topicId/plan                   { level }
GET  /api/learn/:topicId                        syllabus, lessons, progress, cards
GET  /api/learn/:topicId/next                   next lesson (starts writing it)
GET  /api/learn/:topicId/lessons/:i             one lesson (quiz without answers)
POST /api/learn/:topicId/lessons/:i/quiz        { answers: [1, 0, 2, 3] | "b, a, c, d" }   (:i may be "current")
GET  /api/learn/:topicId/cards/due · POST /api/learn/cards/:id/review { knew }
GET  /api/learn/:topicId/pack[?download=1]
POST /api/research/topics/:id/chat              202 { question, pending }; poll GET …/chat
```

Tests: `npm run test:study` (offline), or `SMOKE_LIVE=1 npm run test:study` to plan and write a real lesson.

## Knowledge is measured, and what hurts is benched (22 November)

Evaluations run the same challenges with and without what was learned. With knowledge scored *lower* (0.6–0.7 against
0.8): the same few lessons and findings were handed to every run of challenges they did not fit (a race-condition
diagnosis passed every time without knowledge and half the time with it). `src/learning/KnowledgeImpact.ts` measures
each lesson and finding by the pass rate of the challenges it was given on, against those challenges without any
knowledge. One given at least three times that cost 0.25 or more is **benched**: builds and evaluations are not given
it (it stays searchable, and the reason is kept in `data/learning/benched.json`). It is released when it stops hurting,
and comes back for another trial after 14 days. This runs after every evaluation. Items always given together share
the result, because the data cannot tell them apart; benching the group and measuring again is how that is found out.
`npm run test:knowledge-impact`.

## Selective retrieval and the scorecard (22 November, evening)

Benching the 13 worst items left a pattern: every kind of knowledge still averaged slightly negative, because items
were matched to tasks by single shared words. The race-condition ("stale closure") question was given a finding about
stale-while-revalidate caching; the salon booking-app plan was given marketing advice about booking buttons. Over the
65 measured task-item pairs, items sharing 1-2 specific terms with the task averaged -0.12 and -0.15 and made up all 16
harmful pairings; items sharing 3 or more averaged 0.

So a lesson or finding is now handed out only when it shares at least 3 specific terms with the task
(`KNOWLEDGE_MIN_SHARED_TERMS`), or, for a lesson, when most of its error signature is in the task (the same error).
On the measured pairs this keeps 8 (mean -0.04, none harmful) and drops all 16 harmful ones, and the repair lessons
still match their errors. Fewer, more relevant items, not more.

**The scorecard** (Agent → Evaluations, `GET /api/learning/scorecard`, Jarvis `learning.scorecard`) compares the
latest runs with and without knowledge on the same model, the baseline before benching, retrieval precision (the
share of evidenced items that did not hurt), benched items and whether any was handed out after benching, items
verified useful, regressions, and every run over time. It says plainly when knowledge still hurts.
