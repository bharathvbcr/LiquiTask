import type { AIContext, Task } from "../../types";
import { aiService } from "./aiService";

export interface RiskAssessment {
  taskId: string;
  score: number; // 0-1
  level: "low" | "medium" | "high";
  reason: string;
  bottleneckTasks: string[]; // IDs of tasks causing the risk
  mitigationSuggestion?: string;
}

export interface ProjectRiskSummary {
  overallScore: number;
  criticalPath: string[];
  risks: RiskAssessment[];
  predictionMessage: string;
}

class RiskAnalysisService {
  private static instance: RiskAnalysisService;

  static getInstance(): RiskAnalysisService {
    if (!RiskAnalysisService.instance) {
      RiskAnalysisService.instance = new RiskAnalysisService();
    }
    return RiskAnalysisService.instance;
  }

  /**
   * Analyze project risks based on task dependencies and estimates
   */
  async analyzeProjectRisks(tasks: Task[], context: AIContext): Promise<ProjectRiskSummary> {
    const criticalPath = this.calculateCriticalPath(tasks);
    const heuristicRisks = this.calculateHeuristicRisks(tasks, criticalPath);

    try {
      // Enhance with AI insights for high-risk projects
      const aiRisks = await this.getAIRiskAssessment(tasks, criticalPath, context);
      const combinedRisks = [...heuristicRisks];

      // Add AI risks if not already detected by heuristics (avoid duplicates)
      aiRisks.forEach((aiRisk) => {
        if (!combinedRisks.some((r) => r.taskId === aiRisk.taskId && r.reason === aiRisk.reason)) {
          combinedRisks.push(aiRisk);
        }
      });

      return {
        overallScore: this.calculateOverallScore(combinedRisks),
        criticalPath,
        risks: combinedRisks,
        predictionMessage: this.generatePredictionMessage(combinedRisks, criticalPath.length),
      };
    } catch (e) {
      console.error("AI risk analysis failed, falling back to heuristics:", e);
      return {
        overallScore: this.calculateOverallScore(heuristicRisks),
        criticalPath,
        risks: heuristicRisks,
        predictionMessage: "Heuristic prediction: Monitor tasks on the critical path.",
      };
    }
  }

  private calculateCriticalPath(tasks: Task[]): string[] {
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const taskMap = new Map<string, Task>();

    tasks.forEach((t) => {
      taskMap.set(t.id, t);
      if (!inDegree.has(t.id)) inDegree.set(t.id, 0);

      const blockedBy =
        t.links?.filter((l) => l.type === "blocked-by").map((l) => l.targetTaskId) || [];
      blockedBy.forEach((depId) => {
        const dependentTasks = adj.get(depId) ?? [];
        dependentTasks.push(t.id);
        adj.set(depId, dependentTasks);
        inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
      });
    });

    // Simple critical path: longest chain of dependencies
    // In a real project management tool, this would involve float/slack calculation
    // Here we find the deepest dependency chain
    let maxPath: string[] = [];
    const memo = new Map<string, string[]>();

    const findLongestPath = (id: string): string[] => {
      const memoizedPath = memo.get(id);
      if (memoizedPath) return memoizedPath;

      const children = adj.get(id) || [];
      if (children.length === 0) return [id];

      let longestChildPath: string[] = [];
      for (const childId of children) {
        const path = findLongestPath(childId);
        if (path.length > longestChildPath.length) {
          longestChildPath = path;
        }
      }

      const result = [id, ...longestChildPath];
      memo.set(id, result);
      return result;
    };

    tasks.forEach((t) => {
      const path = findLongestPath(t.id);
      if (path.length > maxPath.length) {
        maxPath = path;
      }
    });

    return maxPath;
  }

  private calculateHeuristicRisks(tasks: Task[], criticalPath: string[]): RiskAssessment[] {
    const risks: RiskAssessment[] = [];
    const now = new Date();

    tasks.forEach((task) => {
      let score = 0;
      const reasons: string[] = [];

      // Risk 1: Overdue or near deadline
      if (task.dueDate && task.status !== "completed") {
        const due = new Date(task.dueDate);
        const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (diff < 0) {
          score += 0.8;
          reasons.push("Task is overdue");
        } else if (diff < 2) {
          score += 0.4;
          reasons.push("Due within 48 hours");
        }
      }

      // Risk 2: Critical Path
      if (criticalPath.includes(task.id)) {
        score += 0.3;
        reasons.push("Task is on the critical path");
      }

      // Risk 3: Large estimate with high priority
      if (task.timeEstimate > 480 && task.priority === "high") {
        score += 0.2;
        reasons.push("Large high-priority task (possible bottleneck)");
      }

      // Risk 4: Dependency density
      const blockers = task.links?.filter((l) => l.type === "blocked-by").length || 0;
      if (blockers > 2) {
        score += 0.2;
        reasons.push(`Blocked by ${blockers} tasks`);
      }

      if (score > 0.2) {
        risks.push({
          taskId: task.id,
          score: Math.min(score, 1.0),
          level: score > 0.7 ? "high" : score > 0.4 ? "medium" : "low",
          reason: reasons.join(", "),
          bottleneckTasks:
            task.links?.filter((l) => l.type === "blocked-by").map((l) => l.targetTaskId) || [],
        });
      }
    });

    return risks;
  }

  private async getAIRiskAssessment(
    tasks: Task[],
    criticalPath: string[],
    context: AIContext,
  ): Promise<RiskAssessment[]> {
    const leanTasks = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
      timeEstimate: t.timeEstimate,
      blockers: t.links?.filter((l) => l.type === "blocked-by").map((l) => l.targetTaskId) || [],
    }));

    const prompt = `Analyze project risks and timeline feasibility. 
Critical Path: ${criticalPath.join(" -> ")}
Tasks: ${JSON.stringify(leanTasks)}

Return JSON array of risks: [{"taskId": "id", "score": 0.9, "level": "high|medium|low", "reason": "why", "mitigationSuggestion": "how to fix"}]`;

    const result = await aiService.analyzeTasks(prompt, tasks, context, {});
    return (result as RiskAssessment[]) || [];
  }

  private calculateOverallScore(risks: RiskAssessment[]): number {
    if (risks.length === 0) return 0;
    const highRisks = risks.filter((r) => r.level === "high").length;
    const mediumRisks = risks.filter((r) => r.level === "medium").length;
    return Math.min(highRisks * 0.3 + mediumRisks * 0.1, 1.0);
  }

  private generatePredictionMessage(risks: RiskAssessment[], cpLength: number): string {
    const high = risks.filter((r) => r.level === "high").length;
    if (high > 2) return `Critical: ${high} major risks detected. Timeline is highly unstable.`;
    if (cpLength > 5)
      return `Warning: Long critical path (${cpLength} steps). Any delay will cascade.`;
    if (risks.length > 0)
      return `Project is healthy but watch out for ${risks.length} potential issues.`;
    return "Timeline looks solid! Low risk of delay.";
  }
}

export const riskAnalysisService = RiskAnalysisService.getInstance();
export default riskAnalysisService;
