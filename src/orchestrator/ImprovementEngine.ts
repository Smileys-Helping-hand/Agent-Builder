import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { QualityAnalysis, QualityIssue } from "../orchestrator/QualityAnalyzer.js";

export interface ImprovementSuggestion {
  type: "refactor" | "test" | "security" | "performance" | "documentation";
  priority: "critical" | "high" | "medium" | "low";
  description: string;
  file?: string;
  action: string;
  expectedImpact: number; // 0-100
}

export interface ImprovementPlan {
  suggestions: string[];
  actions: ImprovementSuggestion[];
  estimatedQualityGain: number;
}

export class ImprovementEngine {

  /**
   * Generate improvement plan based on quality analysis
   */
  async generateImprovements(context: {
    code: Record<string, string>;
    analysis: QualityAnalysis;
    iteration: number;
    targetQuality: number;
  }): Promise<ImprovementPlan> {

    Logger.log("Generating improvement plan", {
      iteration: context.iteration,
      currentScore: context.analysis.overallScore,
      target: context.targetQuality
    });

    const qualityGap = context.targetQuality - context.analysis.overallScore;

    // Prioritize issues by severity and impact
    const sortedIssues = this.prioritizeIssues(context.analysis.issues);

    // Generate specific actions for top issues
    const actions: ImprovementSuggestion[] = [];

    for (const issue of sortedIssues.slice(0, 10)) {
      const action = await this.generateActionForIssue(issue, context.code);
      if (action) {
        actions.push(action);
      }
    }

    // Generate high-level improvement suggestions
    const suggestions = await this.generateSuggestions(
      context.code,
      context.analysis,
      qualityGap
    );

    // Estimate total quality gain
    const estimatedGain = actions.reduce((sum, a) => sum + a.expectedImpact, 0) / actions.length;

    return {
      suggestions,
      actions,
      estimatedQualityGain: Math.min(qualityGap, estimatedGain)
    };
  }

  /**
   * Prioritize issues by severity and category
   */
  private prioritizeIssues(issues: QualityIssue[]): QualityIssue[] {
    const severityWeight = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };

    const categoryWeight = {
      security: 5,
      completeness: 4,
      testing: 3,
      performance: 2,
      usability: 1
    };

    return issues.sort((a, b) => {
      const scoreA = severityWeight[a.severity] * categoryWeight[a.category];
      const scoreB = severityWeight[b.severity] * categoryWeight[b.category];
      return scoreB - scoreA;
    });
  }

  /**
   * Generate specific action for an issue
   */
  private async generateActionForIssue(
    issue: QualityIssue,
    code: Record<string, string>
  ): Promise<ImprovementSuggestion | null> {

    const typeMap: Record<QualityIssue["category"], ImprovementSuggestion["type"]> = {
      security: "security",
      performance: "performance",
      completeness: "refactor",
      usability: "refactor",
      testing: "test"
    };

    const impactMap = {
      critical: 25,
      high: 15,
      medium: 8,
      low: 3
    };

    return {
      type: typeMap[issue.category],
      priority: issue.severity,
      description: issue.description,
      file: issue.file,
      action: issue.suggestion,
      expectedImpact: impactMap[issue.severity]
    };
  }

  /**
   * Generate improvement suggestions using AI
   */
  private async generateSuggestions(
    code: Record<string, string>,
    analysis: QualityAnalysis,
    qualityGap: number
  ): Promise<string[]> {

    try {
      const prompt = `You are an expert code reviewer. Analyze this application and suggest specific improvements.

Current Quality Scores:
- Overall: ${analysis.overallScore.toFixed(1)}%
- Completeness: ${analysis.metrics.completeness.toFixed(1)}%
- Security: ${analysis.metrics.security.toFixed(1)}%
- Performance: ${analysis.metrics.performance.toFixed(1)}%
- Usability: ${analysis.metrics.usability.toFixed(1)}%
- Test Coverage: ${analysis.metrics.testCoverage.toFixed(1)}%

Target Score: ${(analysis.overallScore + qualityGap).toFixed(1)}%
Gap to Close: ${qualityGap.toFixed(1)}%

Top Issues:
${analysis.issues.slice(0, 5).map(i => `- [${i.severity.toUpperCase()}] ${i.description}`).join("\n")}

Files:
${Object.keys(code).slice(0, 10).join("\n")}

Provide 5 specific, actionable improvements that will have the most impact.
Focus on:
1. Security vulnerabilities
2. Missing critical features
3. Test coverage gaps
4. Performance bottlenecks
5. Usability problems

Format as numbered list with concrete actions.`;

      const response = await ModelRouter.generate(prompt);

      return response
        .split("\n")
        .filter(line => line.trim().match(/^\d+\./))
        .map(line => line.replace(/^\d+\.\s*/, "").trim())
        .filter(line => line.length > 10);

    } catch (error: any) {
      Logger.error("Failed to generate AI suggestions", { error: error.message });
      
      // Fallback to rule-based suggestions
      return this.getFallbackSuggestions(analysis);
    }
  }

  /**
   * Get fallback suggestions when AI fails
   */
  private getFallbackSuggestions(analysis: QualityAnalysis): string[] {
    const suggestions: string[] = [];

    if (analysis.metrics.security < 70) {
      suggestions.push("Add input validation and sanitization");
      suggestions.push("Implement proper authentication and authorization");
    }

    if (analysis.metrics.testCoverage < 50) {
      suggestions.push("Add unit tests for critical functions");
      suggestions.push("Implement integration tests for main workflows");
    }

    if (analysis.metrics.performance < 70) {
      suggestions.push("Add caching for expensive operations");
      suggestions.push("Optimize database queries and API calls");
    }

    if (analysis.metrics.completeness < 80) {
      suggestions.push("Complete missing error handling");
      suggestions.push("Add comprehensive documentation");
    }

    if (analysis.metrics.usability < 70) {
      suggestions.push("Improve error messages and user feedback");
      suggestions.push("Add logging and monitoring");
    }

    return suggestions;
  }

  /**
   * Apply a specific improvement action
   */
  async applyImprovement(
    action: ImprovementSuggestion,
    code: Record<string, string>
  ): Promise<Record<string, string>> {

    Logger.log("Applying improvement", {
      type: action.type,
      file: action.file,
      priority: action.priority
    });

    switch (action.type) {
      case "security":
        return this.applySecurityFix(action, code);
      case "test":
        return this.addTests(action, code);
      case "refactor":
        return this.refactorCode(action, code);
      case "performance":
        return this.optimizePerformance(action, code);
      case "documentation":
        return this.addDocumentation(action, code);
      default:
        return code;
    }
  }

  /**
   * Apply security fix
   */
  private async applySecurityFix(
    action: ImprovementSuggestion,
    code: Record<string, string>
  ): Promise<Record<string, string>> {
    
    // Use AI to generate security fix
    if (!action.file) return code;

    const originalCode = code[action.file];
    if (!originalCode) return code;

    try {
      const prompt = `Fix this security issue:
Issue: ${action.description}
Action: ${action.action}

Original Code:
${originalCode}

Provide the fixed version of the ENTIRE file.`;

      const fixedCode = await ModelRouter.generate(prompt);
      
      return {
        ...code,
        [action.file]: fixedCode
      };
    } catch (error) {
      Logger.error("Failed to apply security fix", { error });
      return code;
    }
  }

  /**
   * Add tests for untested code
   */
  private async addTests(
    action: ImprovementSuggestion,
    code: Record<string, string>
  ): Promise<Record<string, string>> {

    if (!action.file) return code;

    const targetFile = code[action.file];
    if (!targetFile) return code;

    try {
      const prompt = `Generate comprehensive tests for this code:

${targetFile}

Create tests that:
1. Test all major functions
2. Include edge cases
3. Test error handling
4. Use Jest/Vitest framework

Provide complete test file.`;

      const testCode = await ModelRouter.generate(prompt);
      const testFilePath = action.file.replace(/\.(ts|js)$/, ".test.$1");

      return {
        ...code,
        [testFilePath]: testCode
      };
    } catch (error) {
      Logger.error("Failed to generate tests", { error });
      return code;
    }
  }

  /**
   * Refactor code for better quality
   */
  private async refactorCode(
    action: ImprovementSuggestion,
    code: Record<string, string>
  ): Promise<Record<string, string>> {

    if (!action.file) return code;

    const originalCode = code[action.file];
    if (!originalCode) return code;

    try {
      const prompt = `Refactor this code:
Issue: ${action.description}
Improvement: ${action.action}

${originalCode}

Provide the refactored version following best practices.`;

      const refactoredCode = await ModelRouter.generate(prompt);

      return {
        ...code,
        [action.file]: refactoredCode
      };
    } catch (error) {
      Logger.error("Failed to refactor code", { error });
      return code;
    }
  }

  /**
   * Optimize performance
   */
  private async optimizePerformance(
    action: ImprovementSuggestion,
    code: Record<string, string>
  ): Promise<Record<string, string>> {

    if (!action.file) return code;

    const originalCode = code[action.file];
    if (!originalCode) return code;

    try {
      const prompt = `Optimize this code for performance:
Issue: ${action.description}
Target: ${action.action}

${originalCode}

Apply performance optimizations like:
- Caching
- Async operations
- Efficient algorithms
- Resource pooling

Provide optimized code.`;

      const optimizedCode = await ModelRouter.generate(prompt);

      return {
        ...code,
        [action.file]: optimizedCode
      };
    } catch (error) {
      Logger.error("Failed to optimize performance", { error });
      return code;
    }
  }

  /**
   * Add documentation
   */
  private async addDocumentation(
    action: ImprovementSuggestion,
    code: Record<string, string>
  ): Promise<Record<string, string>> {

    if (!action.file) return code;

    const originalCode = code[action.file];
    if (!originalCode) return code;

    try {
      const prompt = `Add comprehensive documentation to this code:

${originalCode}

Add:
- JSDoc comments for all functions
- Inline comments for complex logic
- README section explaining this module
- Usage examples

Provide documented version.`;

      const documentedCode = await ModelRouter.generate(prompt);

      return {
        ...code,
        [action.file]: documentedCode
      };
    } catch (error) {
      Logger.error("Failed to add documentation", { error });
      return code;
    }
  }
}
