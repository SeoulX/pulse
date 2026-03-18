"use client";

import { useState } from "react";
import {
  Brain,
  AlertTriangle,
  Info,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";

interface Insight {
  type: "warning" | "info" | "critical" | "success";
  title: string;
  description: string;
}

interface Analysis {
  summary: string;
  score: number | null;
  insights: Insight[];
  recommendations: string[];
}

interface AnalyticsResponse {
  analysis: Analysis;
  endpointCount: number;
  generatedAt: string;
}

const insightIcons: Record<string, typeof AlertTriangle> = {
  warning: AlertTriangle,
  info: Info,
  critical: AlertCircle,
  success: CheckCircle,
};

const insightColors: Record<string, string> = {
  warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  critical: "border-red-200 bg-red-50 text-red-800",
  success: "border-orange-200 bg-orange-50 text-[#8b3a0f]",
};

function ScoreRing({ score }: { score: number }) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 90
      ? "#e8871e"
      : score >= 70
        ? "#eab308"
        : score >= 50
          ? "#f97316"
          : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="130" height="130" className="-rotate-90">
        <circle
          cx="65"
          cy="65"
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="10"
        />
        <circle
          cx="65"
          cy="65"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-center">
        <span className="text-3xl font-bold">{score}</span>
        <span className="block text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAnalysis(endpointId?: string) {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const url = endpointId
        ? `/api/analytics?endpointId=${endpointId}`
        : "/api/analytics";
      const res = await fetch(url);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Analysis failed");
      setData(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title="AI Analytics" />

      <div className="flex justify-end">
        <button
          onClick={() => runAnalysis()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f] disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Brain className="h-4 w-4" />
              Analyze All Endpoints
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="rounded-2xl border bg-card p-12 text-center shadow-sm">
          <Brain className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Click &quot;Analyze All Endpoints&quot; to get AI-powered insights
            about your API health.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Requires ANTHROPIC_API_KEY environment variable
          </p>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Score + Summary */}
          <div className="flex items-start gap-6 rounded-2xl border bg-card p-6 shadow-sm">
            {data.analysis.score != null && (
              <ScoreRing score={data.analysis.score} />
            )}
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Health Summary</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {data.analysis.summary}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {data.endpointCount} endpoints analyzed at{" "}
                {new Date(data.generatedAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Insights */}
          {data.analysis.insights.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Insights</h2>
              {data.analysis.insights.map((insight, i) => {
                const Icon = insightIcons[insight.type] || Info;
                return (
                  <div
                    key={i}
                    className={`rounded-2xl border p-4 ${insightColors[insight.type] || insightColors.info}`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <p className="font-medium">{insight.title}</p>
                        <p className="mt-1 text-sm opacity-90">
                          {insight.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recommendations */}
          {data.analysis.recommendations.length > 0 && (
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Recommendations</h2>
              <ul className="mt-3 space-y-2">
                {data.analysis.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#e8871e]" />
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
