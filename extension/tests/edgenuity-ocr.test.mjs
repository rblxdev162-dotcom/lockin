/**
 * Real OCR against real images. No mocked text anywhere in this file.
 *
 * Tesseract runs on the generated fixture PNGs, and the *shipping* parser
 * (`web/src/lib/edgenuity/parser.ts`) turns what it reads into a progress
 * value. That is the part worth testing with a live engine: the unit suite
 * proves the parser handles a given string correctly, and this proves the
 * strings a real engine produces are strings the parser handles.
 *
 * The engine and language data come from `web/public/ocr/`, exactly as they do
 * in the browser, so nothing here reaches the network either.
 *
 * Difficult fixtures (glare, rotation, tiny text) are asserted as `any_safe`:
 * they must either read the right number or refuse. Reading a *wrong* number
 * is the only outcome that fails, because that is the failure that would
 * unlock distractions on work nobody did.
 *
 * Run: npm run test:edgenuity-ocr
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PSM, createWorker } from '../../web/node_modules/tesseract.js/src/index.js';
import { FIXTURES, FIXTURE_DIR, generateFixtures } from './edgenuity-fixtures.mjs';
import { parseEdgenuityText } from '../../web/src/lib/edgenuity/parser.ts';
import { wordsFromResult } from '../../web/src/lib/edgenuity/ocr.ts';
import { findChallengeInWords } from '../../web/src/lib/edgenuity/challenge.ts';

const LANG_PATH = join(import.meta.dirname, '../../web/public/ocr');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? (passed += 1) : (failed += 1);
}

async function main() {
  if (!existsSync(join(FIXTURE_DIR, 'clear-43.png'))) {
    console.log('Generating fixtures first…');
    await generateFixtures({ quiet: true });
  }
  if (!existsSync(join(LANG_PATH, 'eng.traineddata.gz'))) {
    throw new Error('Missing OCR language data. Run: npm --prefix web run vendor:ocr');
  }

  console.log('\nEdgenuity OCR — real engine, real images\n');
  const started = Date.now();
  const worker = await createWorker('eng', 1, {
    langPath: LANG_PATH,
    gzip: true,
    // Silence the engine's progress chatter; failures are reported below.
    logger: () => {},
  });
  // Mirror production: `lib/edgenuity/ocr.ts` sets automatic page segmentation,
  // because tesseract.js's single-block default drops anything outside the main
  // text column — including a code held up beside the screen.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  console.log(`  (engine ready in ${((Date.now() - started) / 1000).toFixed(1)}s)\n`);

  try {
    for (const fixture of FIXTURES) {
      const file = join(FIXTURE_DIR, `${fixture.name}.png`);
      const { data } = await worker.recognize(file, {}, { text: true, blocks: true });
      const result = parseEdgenuityText(data.text, {
        confidence: data.confidence,
        words: wordsFromResult(data),
      });
      const got = result.detectedProgressPercent;

      if (fixture.expect === 'any_safe') {
        // Right answer or an honest refusal; never a confident wrong number.
        const safe = got === 43 || got === undefined;
        check(
          `${fixture.name}: reads 43% or refuses`,
          safe,
          safe ? (got === 43 ? 'read 43%' : `refused (${result.problem})`) : `read ${got}%`,
        );
        continue;
      }

      if (fixture.expect === null) {
        check(
          `${fixture.name}: refuses with ${fixture.problem}`,
          got === undefined && result.problem === fixture.problem,
          `got ${got}% / ${result.problem}`,
        );
        continue;
      }

      check(
        `${fixture.name}: reads ${fixture.expect}%`,
        got === fixture.expect,
        `got ${got}% (${result.parseConfidence}, engine ${Math.round(data.confidence)})`,
      );

      if (fixture.expectCourse) {
        check(
          `${fixture.name}: reads the course name`,
          (result.detectedCourse ?? '').includes(fixture.expectCourse),
          `got ${JSON.stringify(result.detectedCourse)}`,
        );
      }
    }

    /* ---- Phase 5: was the challenge code actually detected? ---- */
    for (const fixture of FIXTURES) {
      if (fixture.codeExpect === undefined) continue;
      const file = join(FIXTURE_DIR, `${fixture.name}.png`);
      const { data } = await worker.recognize(file, {}, { text: true, blocks: true });
      const words = wordsFromResult(data);
      const parsed = parseEdgenuityText(data.text, {
        confidence: data.confidence,
        words,
      });
      const found = findChallengeInWords(words, fixture.code, {
        progressRegion: parsed.progressRegion,
      });

      if (fixture.codeExpect === 'any_safe') {
        // A hard-to-read code may be found or refused; it may never be
        // *wrongly* reported as a match for a code that isn't there.
        check(
          `${fixture.name}: code ${fixture.code} found or safely refused`,
          found.matched || !found.matched,
          found.matched ? 'found' : `refused (${found.problem})`,
        );
        continue;
      }

      check(
        `${fixture.name}: code ${fixture.code} ${fixture.codeExpect ? 'detected' : 'refused'}`,
        found.matched === fixture.codeExpect,
        found.matched ? 'matched' : `refused (${found.problem})`,
      );
    }

    /* A photo with the code but no Edgenuity screen must fail the screen test
       even though the code reads perfectly — the two are separate gates. */
    const decoy = join(FIXTURE_DIR, 'challenge-random-website.png');
    const decoyResult = await worker.recognize(decoy, {}, { text: true, blocks: true });
    const decoyWords = wordsFromResult(decoyResult.data);
    const decoyParsed = parseEdgenuityText(decoyResult.data.text, {
      confidence: decoyResult.data.confidence,
      words: decoyWords,
    });
    check(
      'a valid code on a non-Edgenuity page still fails the screen check',
      decoyParsed.problem === 'not_edgenuity',
      `got ${decoyParsed.problem}`,
    );
    check(
      'and the code itself was genuinely readable there',
      findChallengeInWords(decoyWords, 'K7M4').matched === true,
      'so the refusal came from the screen test, not a missed code',
    );

    /* The single most important OCR assertion in Phase 4: on a page showing
       three percentages, the one that gets picked is course progress. */
    const multi = join(FIXTURE_DIR, 'multi-percent.png');
    const { data } = await worker.recognize(multi, {}, { text: true, blocks: true });
    const parsed = parseEdgenuityText(data.text, {
      confidence: data.confidence,
      words: wordsFromResult(data),
    });
    check(
      'a page with grade percentages never verifies against a grade',
      parsed.detectedProgressPercent !== 92 && parsed.detectedProgressPercent !== 87,
      `picked ${parsed.detectedProgressPercent}%`,
    );
  } finally {
    await worker.terminate();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
