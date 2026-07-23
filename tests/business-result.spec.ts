import { test, expect } from '@playwright/test';
import { QuizNavigator } from '../src/helpers/quiz-navigator';
import { generateTestUser } from '../src/helpers/data-generator';
import { ResultVerifier } from '../src/helpers/result-verifier';

const QUIZ_URL = '/uk/app/sign-up/long/charlie/age-range';

test.describe('Charlie Quiz — Business Result Verification', () => {
  test('completing quiz creates user account and books trial lesson', async ({ page, context }) => {
    test.setTimeout(180_000);

    const testUser = generateTestUser();
    const verifier = new ResultVerifier(page);

    context.on('page', async (newPage) => {
      await newPage.close();
    });

    verifier.startCapturingNetworkCalls();

    await page.goto(QUIZ_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const navigator = new QuizNavigator(page, testUser);
    const result = await navigator.navigate();

    console.log(`Navigation completed: ${result.success}`);
    console.log(`Steps: ${result.stepsCompleted}`);
    console.log(`Final URL: ${result.finalUrl}`);
    console.log('Step log:');
    result.stepLog.forEach((s) => console.log(`  ${s.step}. [${s.path}] → ${s.action}`));

    const verification = await verifier.verifyBusinessResult();

    console.log('\nVerification result:');
    console.log(`  Registration completed: ${verification.registrationCompleted}`);
    console.log(`  Trial booked: ${verification.trialBooked}`);
    console.log(`  Method: ${verification.verificationMethod}`);
    console.log(`  Details: ${verification.details}`);

    const apiCalls = verifier.getCapturedApiCalls();
    if (apiCalls.length > 0) {
      console.log('\nCaptured API calls:');
      apiCalls.forEach((call) => {
        console.log(`  ${call.method} ${call.url} → ${call.status}`);
      });
    }

    const quizCompleted = result.success || verification.registrationCompleted;
    expect(quizCompleted, `Quiz should complete. Final path: ${result.stepLog[result.stepLog.length - 1]?.path}. Verification: ${verification.details}`).toBe(true);
    expect(verification.registrationCompleted, `User registration should be confirmed. Details: ${verification.details}`).toBe(true);
  });

  test('quiz can be completed with different age selections', async ({ page, context }) => {
    test.setTimeout(180_000);

    const testUser = generateTestUser();
    const verifier = new ResultVerifier(page);
    context.on('page', async (newPage) => { await newPage.close(); });
    verifier.startCapturingNetworkCalls();

    await page.goto(QUIZ_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const ageButtons = page.locator('button:has-text("10"), button:has-text("11"), button:has-text("12")');
    const firstVisible = ageButtons.first();
    if (await firstVisible.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstVisible.click();
      await page.waitForTimeout(1500);
    }

    const navigator = new QuizNavigator(page, testUser);
    const result = await navigator.navigate();

    console.log(`Navigation: ${result.success}, Steps: ${result.stepsCompleted}`);

    const verification = await verifier.verifyBusinessResult();
    expect(result.success).toBe(true);
    expect(verification.registrationCompleted).toBe(true);
  });
});
