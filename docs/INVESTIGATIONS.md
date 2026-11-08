# Deep investigations

**Research → Deep investigation**, or ask Jarvis (`investigate.start`). Give it an
objective ("how to make the best-tasting coffee possible") and it works it through.
It takes hours: it reads real sources, on this PC's model.

## The stages

1. **Plan.** The model writes the domain, scope and what success means, for this
   subject: the specialists (each with an objective, questions and the evidence it
   needs), the measurable variables and the hypotheses.
2. **Specialists.** Each is a topic in the research engine: it searches, reads, keeps
   findings checked against the source text and ranked by source credibility. A
   specialist that depends on another waits for it. A specialist is finished by what
   it found (12 findings a round by default) or when sources stop yielding, not by a
   clock alone. Each one opens to show its findings.
3. **Experiments.** What can be computed is computed. The model writes
   `simulate(params)` with its assumptions stated; the engine (not the model) runs it
   over every combination, ranks them, measures sensitivity, and repeats the best from
   the same seed. Broken code goes back to the model with the error, up to twice. What
   needs the real world (taste, a lab measurement) becomes a **physical experiment**
   with a protocol for a person.
4. **Contradictions.** Findings that disagree are named, side by side, never averaged.
   Each side must point at real findings or it is dropped.
5. **Synthesis.** Recommendations cite findings by number. A citation of nothing is
   removed and flagged, and "high" confidence needs at least two findings. Material open
   questions go back to the specialists for one more round.
6. **Learning.** Recommendations with at least two findings become candidate knowledge.

## What the numbers mean

A simulation's result is what its model computes under its stated assumptions, not a
measurement of the world. Each result says so and keeps its assumptions and code. The
evidence matrix, source register and counts are generated from the records, not written
by a model. The final conclusions are written by the local model from that evidence,
so read them with their citations; nothing in it has tasted coffee.

## The sandbox

Simulation code comes from a model that has read web pages, so it is untrusted. It runs
in its own process under Node's permission model (no reading or writing files outside
its own folder, no child processes), with an empty environment, in a VM context with no
`require`, for at most a minute. Network access is not blocked by Node 24's permission
model; the code has no `fetch` in its context, but code that escapes the context could
open a socket. `Math.random` is seeded, so runs reproduce.

## Giving feedback

A note on an investigation is kept, linked to it, and becomes a priority question for a
specialist. Tests: `npm run test:investigation`.

## What changed on 8 November, and why

The first coffee investigation found nothing and still wrote a confident report. Its specialists' titles carried words
no page uses ("Brewing Method Specialist (Research how to…"), and the relevance check threw every good page away. Then
the report was written from no evidence. Fixed, and the researcher is built to crack questions now:

- **Scholarly sources:** OpenAlex (about 250 million papers, every field) and Europe PMC (the life sciences), free and
  keyless, ranked first for anything that is not code. Each paper comes with its year, journal and citations.
- **Relevance** is checked against the question being researched as well as the topic, ignoring words that only say what
  a title is ("specialist", "research", "optimal"), but still needing the subject's most distinctive word.
- **A specialist that finds little re-plans:** new searches in the words papers use, narrower questions, twice before it
  gives up. Investigation specialists go first in the research queue.
- **Answers with verdicts:** every research question and hypothesis gets an answer citing findings, and a verdict
  (answered, supported, refuted, contested, not answered) with a confidence counted from what those findings are
  (peer-reviewed counts most), never asked of the model. Unanswered questions go back for up to three rounds.
- **No conclusions on thin evidence:** with fewer than 6 findings in all, the report says plainly that it could not be
  answered, lists what it could not find, and nothing is learned. Recommendations citing nothing are left out.
  Experiments need 10 findings, and one whose assumptions cite no finding is refused, because its numbers would be invented.

The old coffee report is marked superseded; a new one, and "How do plants communicate with each other?", are running.
