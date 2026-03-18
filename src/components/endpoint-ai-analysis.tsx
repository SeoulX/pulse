"use client";

import { useState } from "react";
import { Brain, Loader2, AlertTriangle, Info, AlertCircle, CheckCircle } from "lucide-react";

interface Insight {
  type: string;
  title: string;
  description: string;
}

const insightIcons: Record<string, typeof Info> = {
  warning: AlertTriangle,
  info: Info,
  critical: AlertCircle,
  success: CheckCircle,
};

const insightColors: Record<string, string> = {
  warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  critical: "border-red-200 bg-red-50 text-red-800",
  success: "border-green-200 bg-green-50 text-green-800",
};

export function EndpointAIAnalysis({ endpointId }: { endpointId: string }) {
  const [analysis, setAnalysis] = useState<{
    summary: string;
    score: number | null;
    insights: Insight[];
    recommendations: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/analytics?endpointId=${endpointId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalysis(data.analysis);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Brain className="h-5 w-5 text-[#e8871e] dark:text-[#5ab4c5]" />
          AI Analysis
        </h2>
        <button
          onClick={analyze}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#2d1b0e] disabled:opacity-50 dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Brain className="h-4 w-4" />
          )}
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {analysis && (
        <div className="space-y-3">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            {analysis.score != null && (
              <div className="mb-2">
                <span className="text-xs text-muted-foreground">Health Score: </span>
                <span
                  className={`text-lg font-bold ${
                    analysis.score >= 90
                      ? "text-green-600"
                      : analysis.score >= 70
                        ? "text-yellow-600"
                        : "text-red-600"
                  }`}
                >
                  {analysis.score}/100
                </span>
              </div>
            )}
            <p className="text-sm leading-relaxed">{analysis.summary}</p>
          </div>

          {analysis.insights.map((insight, i) => {
            const Icon = insightIcons[insight.type] || Info;
            return (
              <div
                key={i}
                className={`rounded-lg border p-3 ${insightColors[insight.type] || insightColors.info}`}
              >
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{insight.title}</p>
                    <p className="text-xs opacity-90">{insight.description}</p>
                  </div>
                </div>
              </div>
            );
          })}

          {analysis.recommendations.length > 0 && (
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Recommendations
              </p>
              <ul className="space-y-1">
                {analysis.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1a1a1a] dark:bg-[#2a7f9e]" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
