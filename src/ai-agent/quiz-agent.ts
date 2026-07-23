import { Page } from '@playwright/test';
import Anthropic from '@anthropic-ai/sdk';
import { TestUserData } from '../helpers/data-generator';

export interface AgentResult {
  success: boolean;
  iterations: number;
  finalUrl: string;
  actionLog: AgentAction[];
  error?: string;
}

export interface AgentAction {
  iteration: number;
  thought: string;
  action: ActionCommand;
  result: string;
}

export type ActionCommand =
  | { type: 'click'; selector: string }
  | { type: 'fill'; selector: string; value: string }
  | { type: 'done'; reason: string }
  | { type: 'wait' };

const SYSTEM_PROMPT = `You are a QA automation agent navigating a registration quiz for an online English school for children (AllRight).

Your goal: Complete the registration quiz from start to finish, resulting in a user account being created and a trial lesson being booked.

The quiz consists of multiple steps with questions about the child (age, English level, preferences, schedule, etc.). At the end, you'll need to provide contact information (email, phone) to complete registration.

RULES:
1. On each step, analyze the screenshot and decide what to do next.
2. Select appropriate options that make sense for a typical parent registering their child.
3. When you see input fields, fill them with the provided test data.
4. Click "Продовжити" (Continue), "Далі" (Next), or similar buttons when needed.
5. If a step has clickable cards/options, select one that seems reasonable.
6. Never click back/navigation arrows.
7. When you see a confirmation/success screen, report done.

IMPORTANT: Respond ONLY with a JSON object, no other text. The JSON must have this structure:
{
  "thought": "brief reasoning about current state",
  "action": { "type": "click"|"fill"|"done"|"wait", "selector": "CSS selector", "value": "text to type" }
}

For "click": provide a CSS selector or text-based selector.
For "fill": provide selector and value.
For "done": provide reason.
For "wait": no additional fields needed (use when page is loading).`;

export class QuizAgent {
  private page: Page;
  private client: Anthropic;
  private userData: TestUserData;
  private maxIterations: number;
  private actionLog: AgentAction[] = [];

  constructor(page: Page, userData: TestUserData, maxIterations = 30) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required for AI agent');
    }

    this.page = page;
    this.client = new Anthropic({ apiKey });
    this.userData = userData;
    this.maxIterations = maxIterations;
  }

  async run(): Promise<AgentResult> {
    for (let i = 1; i <= this.maxIterations; i++) {
      try {
        const action = await this.performIteration(i);

        if (action.action.type === 'done') {
          return {
            success: true,
            iterations: i,
            finalUrl: this.page.url(),
            actionLog: this.actionLog,
          };
        }
      } catch (error: any) {
        this.actionLog.push({
          iteration: i,
          thought: 'Error occurred',
          action: { type: 'wait' },
          result: `Error: ${error.message}`,
        });

        if (error.message.includes('API') || error.message.includes('rate limit')) {
          await this.page.waitForTimeout(5000);
        }
      }
    }

    return {
      success: false,
      iterations: this.maxIterations,
      finalUrl: this.page.url(),
      actionLog: this.actionLog,
      error: `Max iterations (${this.maxIterations}) reached`,
    };
  }

  private async performIteration(iteration: number): Promise<AgentAction> {
    await this.page.waitForTimeout(1500);

    const screenshot = await this.page.screenshot({ type: 'jpeg', quality: 75 });
    const base64Screenshot = screenshot.toString('base64');

    const pageContext = await this.getPageContext();

    const userMessage = `Current URL: ${this.page.url()}
Page context: ${pageContext}
Test data to use when filling forms:
- Child name: ${this.userData.childName}
- Email: ${this.userData.email}
- Phone: ${this.userData.phone}
- Parent name: ${this.userData.parentName}

What action should I take? Remember: respond ONLY with JSON.`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64Screenshot },
            },
            { type: 'text', text: userMessage },
          ],
        },
      ],
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    const command = this.parseCommand(responseText);

    const action: AgentAction = {
      iteration,
      thought: command.thought || 'no thought',
      action: command.action,
      result: '',
    };

    action.result = await this.executeAction(command.action);
    this.actionLog.push(action);

    return action;
  }

  private async getPageContext(): Promise<string> {
    return await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button:not([disabled])'))
        .map((b) => (b as HTMLElement).innerText?.trim())
        .filter((t) => t && t.length > 0 && t.length < 100);

      const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"])')).map((i) => {
        const input = i as HTMLInputElement;
        return `${input.type || 'text'}[name="${input.name}"][placeholder="${input.placeholder}"]`;
      });

      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, p'))
        .map((h) => (h as HTMLElement).innerText?.trim())
        .filter((t) => t && t.length > 2 && t.length < 200)
        .slice(0, 5);

      return JSON.stringify({ buttons: buttons.slice(0, 15), inputs, headings });
    });
  }

  private parseCommand(text: string): { thought: string; action: ActionCommand } {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        thought: parsed.thought || '',
        action: this.normalizeAction(parsed.action),
      };
    } catch {
      return { thought: `Parse failed: ${text.substring(0, 100)}`, action: { type: 'wait' } };
    }
  }

  private normalizeAction(raw: any): ActionCommand {
    if (!raw || !raw.type) return { type: 'wait' };

    switch (raw.type) {
      case 'click':
        return { type: 'click', selector: raw.selector || raw.text || '' };
      case 'fill':
        return { type: 'fill', selector: raw.selector || '', value: raw.value || '' };
      case 'done':
        return { type: 'done', reason: raw.reason || 'completed' };
      default:
        return { type: 'wait' };
    }
  }

  private async executeAction(action: ActionCommand): Promise<string> {
    switch (action.type) {
      case 'click':
        return await this.executeClick(action.selector);
      case 'fill':
        return await this.executeFill(action.selector, action.value);
      case 'done':
        return `Agent reports done: ${action.reason}`;
      case 'wait':
        await this.page.waitForTimeout(2000);
        return 'waited';
    }
  }

  private async executeClick(selector: string): Promise<string> {
    try {
      const textBtn = this.page.locator(`button:has-text("${selector}")`).first();
      if (await textBtn.isVisible({ timeout: 2000 })) {
        await textBtn.click();
        return `clicked button with text: ${selector}`;
      }

      const element = this.page.locator(selector).first();
      if (await element.isVisible({ timeout: 2000 })) {
        await element.click();
        return `clicked: ${selector}`;
      }

      const fuzzy = this.page.locator(`text="${selector}"`).first();
      if (await fuzzy.isVisible({ timeout: 1000 })) {
        await fuzzy.click();
        return `clicked text: ${selector}`;
      }

      return `element not found: ${selector}`;
    } catch (e: any) {
      return `click failed: ${e.message}`;
    }
  }

  private async executeFill(selector: string, value: string): Promise<string> {
    try {
      const element = this.page.locator(selector).first();
      if (await element.isVisible({ timeout: 2000 })) {
        await element.fill(value);
        return `filled ${selector} with ${value}`;
      }

      const input = this.page.locator(`input:visible`).first();
      if (await input.isVisible({ timeout: 1000 })) {
        await input.fill(value);
        return `filled first visible input with ${value}`;
      }

      return `input not found: ${selector}`;
    } catch (e: any) {
      return `fill failed: ${e.message}`;
    }
  }
}
