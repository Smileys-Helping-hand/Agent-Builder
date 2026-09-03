import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import * as fs from "fs/promises";
import * as path from "path";

export interface QualityMetrics {
  completeness: number;      // 0-100: How complete is the application
  security: number;           // 0-100: Security best practices score
  performance: number;        // 0-100: Performance optimization score
  usability: number;          // 0-100: User experience score
  testCoverage: number;       // 0-100: Test coverage percentage
}

export interface QualityAnalysis {
  overallScore: number;
  metrics: QualityMetrics;
  issues: QualityIssue[];
  recommendations: string[];
  strengths: string[];
}

export interface QualityIssue {
  severity: "critical" | "high" | "medium" | "low";
  category: "security" | "performance" | "completeness" | "usability" | "testing";
  description: string;
  file?: string;
  line?: number;
  suggestion: string;
}

export class QualityAnalyzer {
  
  /**
   * Analyze code quality comprehensively
   */
  async analyze(context: {
    code: Record<string, string>;
    iteration: number;
    previousAnalysis?: any;
  }): Promise<QualityAnalysis> {
    
    Logger.log("Starting quality analysis", { 
      iteration: context.iteration,
      fileCount: Object.keys(context.code).length 
    });

    const analysis: QualityAnalysis = {
      overallScore: 0,
      metrics: {
        completeness: 0,
        security: 0,
        performance: 0,
        usability: 0,
        testCoverage: 0
      },
      issues: [],
      recommendations: [],
      strengths: []
    };

    // Run all quality checks in parallel
    const [
      completenessResult,
      securityResult,
      performanceResult,
      usabilityResult,
      testingResult
    ] = await Promise.all([
      this.checkCompleteness(context.code),
      this.checkSecurity(context.code),
      this.checkPerformance(context.code),
      this.checkUsability(context.code),
      this.checkTestCoverage(context.code)
    ]);

    // Aggregate results
    analysis.metrics.completeness = completenessResult.score;
    analysis.metrics.security = securityResult.score;
    analysis.metrics.performance = performanceResult.score;
    analysis.metrics.usability = usabilityResult.score;
    analysis.metrics.testCoverage = testingResult.score;

    analysis.issues.push(
      ...completenessResult.issues,
      ...securityResult.issues,
      ...performanceResult.issues,
      ...usabilityResult.issues,
      ...testingResult.issues
    );

    // Calculate overall score (weighted average)
    analysis.overallScore = this.calculateOverallScore(analysis.metrics);

    // Generate recommendations using AI
    analysis.recommendations = await this.generateRecommendations(context.code, analysis);

    // Identify strengths
    analysis.strengths = this.identifyStrengths(analysis.metrics);

    Logger.log("Quality analysis complete", {
      overallScore: analysis.overallScore,
      issueCount: analysis.issues.length,
      criticalIssues: analysis.issues.filter(i => i.severity === "critical").length
    });

    return analysis;
  }

  /**
   * Check if all required components are present
   */
  private async checkCompleteness(code: Record<string, string>): Promise<{
    score: number;
    issues: QualityIssue[];
  }> {
    const issues: QualityIssue[] = [];
    const files = Object.keys(code);

    // Check for essential files
    const hasPackageJson = files.some(f => f.includes("package.json"));
    const hasReadme = files.some(f => f.toLowerCase().includes("readme"));
    const hasMainEntry = files.some(f => f.includes("index") || f.includes("main"));
    const hasConfig = files.some(f => f.includes("config") || f.includes(".json"));

    if (!hasPackageJson) {
      issues.push({
        severity: "high",
        category: "completeness",
        description: "Missing package.json or dependency manifest",
        suggestion: "Add package.json with project metadata and dependencies"
      });
    }

    if (!hasReadme) {
      issues.push({
        severity: "medium",
        category: "completeness",
        description: "Missing README documentation",
        suggestion: "Add comprehensive README with setup and usage instructions"
      });
    }

    if (!hasMainEntry) {
      issues.push({
        severity: "critical",
        category: "completeness",
        description: "No main entry point found",
        suggestion: "Add index.ts/js or main application file"
      });
    }

    // Check code completeness with AI
    const aiScore = await this.aiCheckCompleteness(code);

    // Calculate score
    let score = 100;
    score -= issues.filter(i => i.severity === "critical").length * 25;
    score -= issues.filter(i => i.severity === "high").length * 15;
    score -= issues.filter(i => i.severity === "medium").length * 5;
    
    // Blend with AI score
    score = (score * 0.6) + (aiScore * 0.4);

    return { score: Math.max(0, score), issues };
  }

  /**
   * Check for security vulnerabilities
   */
  private async checkSecurity(code: Record<string, string>): Promise<{
    score: number;
    issues: QualityIssue[];
  }> {
    const issues: QualityIssue[] = [];

    for (const [filepath, content] of Object.entries(code)) {
      // Check for common security issues
      if (content.includes("eval(")) {
        issues.push({
          severity: "critical",
          category: "security",
          description: "Use of eval() detected - major security risk",
          file: filepath,
          suggestion: "Remove eval() and use safer alternatives"
        });
      }

      if (content.match(/password\s*=\s*["'][^"']+["']/i)) {
        issues.push({
          severity: "critical",
          category: "security",
          description: "Hardcoded password detected",
          file: filepath,
          suggestion: "Use environment variables for sensitive data"
        });
      }

      if (content.includes("crypto.createHash('md5')") || content.includes("crypto.createHash('sha1')")) {
        issues.push({
          severity: "high",
          category: "security",
          description: "Weak cryptographic algorithm (MD5/SHA1) detected",
          file: filepath,
          suggestion: "Use SHA-256 or stronger algorithms"
        });
      }

      if (content.match(/SQL.*\+.*\$/)) {
        issues.push({
          severity: "critical",
          category: "security",
          description: "Possible SQL injection vulnerability",
          file: filepath,
          suggestion: "Use parameterized queries or ORM"
        });
      }

      if (!content.includes("helmet") && filepath.includes("server")) {
        issues.push({
          severity: "medium",
          category: "security",
          description: "Server missing security headers middleware",
          file: filepath,
          suggestion: "Add helmet.js for security headers"
        });
      }
    }

    // Calculate score
    let score = 100;
    score -= issues.filter(i => i.severity === "critical").length * 30;
    score -= issues.filter(i => i.severity === "high").length * 20;
    score -= issues.filter(i => i.severity === "medium").length * 10;

    return { score: Math.max(0, score), issues };
  }

  /**
   * Check for performance optimization
   */
  private async checkPerformance(code: Record<string, string>): Promise<{
    score: number;
    issues: QualityIssue[];
  }> {
    const issues: QualityIssue[] = [];

    for (const [filepath, content] of Object.entries(code)) {
      // Check for performance anti-patterns
      if (content.match(/for.*for.*for/s)) {
        issues.push({
          severity: "medium",
          category: "performance",
          description: "Nested loops detected - potential O(n³) complexity",
          file: filepath,
          suggestion: "Consider optimizing algorithm or using better data structures"
        });
      }

      if (content.includes("JSON.parse(JSON.stringify")) {
        issues.push({
          severity: "low",
          category: "performance",
          description: "Inefficient deep clone using JSON parse/stringify",
          file: filepath,
          suggestion: "Use structuredClone() or a proper deep clone library"
        });
      }

      if (!content.includes("cache") && filepath.includes("api")) {
        issues.push({
          severity: "medium",
          category: "performance",
          description: "API endpoints missing caching strategy",
          file: filepath,
          suggestion: "Implement appropriate caching (Redis, memory, etc.)"
        });
      }

      // Check for blocking operations in async code
      if (content.match(/async.*\{[^}]*(?:readFileSync|writeFileSync)/s)) {
        issues.push({
          severity: "high",
          category: "performance",
          description: "Blocking sync operations in async functions",
          file: filepath,
          suggestion: "Use async file operations (readFile, writeFile)"
        });
      }
    }

    let score = 100;
    score -= issues.filter(i => i.severity === "high").length * 20;
    score -= issues.filter(i => i.severity === "medium").length * 10;
    score -= issues.filter(i => i.severity === "low").length * 5;

    return { score: Math.max(0, score), issues };
  }

  /**
   * Check usability and user experience
   */
  private async checkUsability(code: Record<string, string>): Promise<{
    score: number;
    issues: QualityIssue[];
  }> {
    const issues: QualityIssue[] = [];
    let score = 100;

    // Check for error handling
    let hasErrorHandling = false;
    for (const content of Object.values(code)) {
      if (content.includes("try") && content.includes("catch")) {
        hasErrorHandling = true;
        break;
      }
    }

    if (!hasErrorHandling) {
      issues.push({
        severity: "high",
        category: "usability",
        description: "No error handling found",
        suggestion: "Add try-catch blocks and proper error messages"
      });
      score -= 20;
    }

    // Check for logging
    const hasLogging = Object.values(code).some(c => 
      c.includes("console.log") || c.includes("logger")
    );

    if (!hasLogging) {
      issues.push({
        severity: "medium",
        category: "usability",
        description: "No logging implementation",
        suggestion: "Add logging for debugging and monitoring"
      });
      score -= 10;
    }

    // Check for configuration
    const hasConfig = Object.keys(code).some(f => 
      f.includes("config") || f.includes(".env")
    );

    if (!hasConfig) {
      issues.push({
        severity: "medium",
        category: "usability",
        description: "No configuration management",
        suggestion: "Add config files for environment-specific settings"
      });
      score -= 10;
    }

    return { score: Math.max(0, score), issues };
  }

  /**
   * Check test coverage
   */
  private async checkTestCoverage(code: Record<string, string>): Promise<{
    score: number;
    issues: QualityIssue[];
  }> {
    const issues: QualityIssue[] = [];
    
    const testFiles = Object.keys(code).filter(f => 
      f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__")
    );

    const sourceFiles = Object.keys(code).filter(f => 
      (f.endsWith(".ts") || f.endsWith(".js")) && 
      !f.includes(".test.") && 
      !f.includes(".spec.")
    );

    const coverageRatio = sourceFiles.length > 0 
      ? (testFiles.length / sourceFiles.length) * 100 
      : 0;

    if (testFiles.length === 0) {
      issues.push({
        severity: "high",
        category: "testing",
        description: "No tests found",
        suggestion: "Add unit tests for core functionality"
      });
    } else if (coverageRatio < 50) {
      issues.push({
        severity: "medium",
        category: "testing",
        description: `Low test coverage (${coverageRatio.toFixed(0)}%)`,
        suggestion: "Increase test coverage to at least 70%"
      });
    }

    return { 
      score: Math.min(100, coverageRatio), 
      issues 
    };
  }

  /**
   * Use AI to check completeness
   */
  private async aiCheckCompleteness(code: Record<string, string>): Promise<number> {
    try {
      const fileList = Object.keys(code).join("\n");
      const sampleCode = Object.values(code).slice(0, 3).join("\n\n");

      const prompt = `Analyze this application for completeness (0-100):

Files present:
${fileList}

Sample code:
${sampleCode.substring(0, 2000)}

Rate completeness considering:
- All necessary components present
- Proper project structure
- Required dependencies
- Documentation
- Configuration

Return only a number 0-100.`;

      const response = await ModelRouter.generate(prompt);

      const score = parseInt(response.trim());
      return isNaN(score) ? 70 : Math.max(0, Math.min(100, score));
    } catch (error) {
      Logger.error("AI completeness check failed", { error });
      return 70; // Default fallback
    }
  }

  /**
   * Generate improvement recommendations using AI
   */
  private async generateRecommendations(
    code: Record<string, string>,
    analysis: QualityAnalysis
  ): Promise<string[]> {
    try {
      const criticalIssues = analysis.issues
        .filter(i => i.severity === "critical" || i.severity === "high")
        .slice(0, 5);

      const prompt = `Based on this code analysis, provide 3-5 specific improvement recommendations:

Quality Scores:
- Completeness: ${analysis.metrics.completeness}%
- Security: ${analysis.metrics.security}%
- Performance: ${analysis.metrics.performance}%
- Usability: ${analysis.metrics.usability}%
- Test Coverage: ${analysis.metrics.testCoverage}%

Critical Issues:
${criticalIssues.map(i => `- ${i.description}`).join("\n")}

Provide actionable recommendations to reach 90%+ quality.
Format as numbered list.`;

      const response = await ModelRouter.generate(prompt);

      return response
        .split("\n")
        .filter(line => line.trim().match(/^\d+\./))
        .map(line => line.replace(/^\d+\.\s*/, "").trim());

    } catch (error) {
      Logger.error("Failed to generate recommendations", { error });
      return ["Review and fix critical security issues", "Add comprehensive tests", "Improve error handling"];
    }
  }

  /**
   * Calculate weighted overall score
   */
  private calculateOverallScore(metrics: QualityMetrics): number {
    const weights = {
      completeness: 0.25,
      security: 0.30,
      performance: 0.20,
      usability: 0.15,
      testCoverage: 0.10
    };

    return (
      metrics.completeness * weights.completeness +
      metrics.security * weights.security +
      metrics.performance * weights.performance +
      metrics.usability * weights.usability +
      metrics.testCoverage * weights.testCoverage
    );
  }

  /**
   * Identify what the code does well
   */
  private identifyStrengths(metrics: QualityMetrics): string[] {
    const strengths: string[] = [];

    if (metrics.security >= 80) strengths.push("Strong security practices");
    if (metrics.performance >= 80) strengths.push("Well-optimized performance");
    if (metrics.testCoverage >= 70) strengths.push("Good test coverage");
    if (metrics.completeness >= 90) strengths.push("Comprehensive implementation");
    if (metrics.usability >= 85) strengths.push("Excellent user experience");

    return strengths;
  }
}
