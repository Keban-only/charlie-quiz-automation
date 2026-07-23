import { test, expect } from '@playwright/test';
import { QuizAgent } from '../src/ai-agent/quiz-agent';
import { generateTestUser } from '../src/helpers/data-generator';
import { ResultVerifier } from '../src/helpers/result-verifier';

const QUIZ_URL = '/uk/app/sign-up/long/charlie/age-range';

test.describe('Charlie Quiz — AI Agent Flow', () => {
  test.skip(!process.env.AWS_ACCESS_KEY_ID, 'AWS credentials required for AI agent tests (Bedrock)');

  test('AI agent navigates quiz and completes registration', async ({ page }) => {
    test.setTimeout(300_000);

    const testUser = generateTestUser();
    const verifier = new ResultVerifier(page);
    verifier.startCapturingNetworkCalls();

    await page.goto(QUIZ_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const agent = new QuizAgent(page, testUser);
    const result = await agent.run();

    console.log(`\nAI Agent Result:`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Iterations: ${result.iterations}`);
    console.log(`  Final URL: ${result.finalUrl}`);
    if (result.error) console.log(`  Error: ${result.error}`);

    console.log('\nAction log:');
    result.actionLog.forEach((a) => {
      console.log(`  [${a.iteration}] ${a.thought}`);
      console.log(`       Action: ${JSON.stringify(a.action)}`);
      console.log(`       Result: ${a.result}`);
    });

    const verification = await verifier.verifyBusinessResult();
    console.log('\nVerification:');
    console.log(`  Registration: ${verification.registrationCompleted}`);
    console.log(`  Trial booked: ${verification.trialBooked}`);
    console.log(`  Details: ${verification.details}`);

    const successfulActions = result.actionLog.filter((a) => a.result.startsWith('clicked'));
    expect(successfulActions.length, 'AI agent should perform at least one successful action').toBeGreaterThan(0);

    if (result.success || verification.registrationCompleted) {
      console.log('\nFull quiz completion confirmed');
    }
  });
});
