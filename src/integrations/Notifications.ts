import fetch from "node-fetch";
import { Logger } from "../utils/Logger.js";

const slackWebhook = process.env.SLACK_WEBHOOK_URL;
const githubToken = process.env.GITHUB_TOKEN;
const githubRepo = process.env.GITHUB_REPOSITORY;

export const Notifications = {
  async sendSlackMessage(message: string) {
    if (!slackWebhook) return;
    try {
      await fetch(slackWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message })
      });
    } catch (error) {
      Logger.warn("Failed to send Slack message", error);
    }
  },
  async createPullRequest(title: string, body: string, branch: string) {
    if (!githubToken || !githubRepo) return;
    try {
      const response = await fetch(`https://api.github.com/repos/${githubRepo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json"
        },
        body: JSON.stringify({ title, body, head: branch, base: "main" })
      });
      if (!response.ok) {
        const text = await response.text();
        Logger.warn("GitHub PR creation failed", { status: response.status, text });
      }
    } catch (error) {
      Logger.warn("Failed to create GitHub PR", error);
    }
  }
};
