import React from "react";
import { useAuth } from "@/lib/AuthContext";
import { checkAccess } from "@/lib/planConfig";
import UpgradeWall from "@/components/shared/UpgradeWall";
import SalesPerformanceDashboard from "@/components/reports/SalesPerformanceDashboard";

export default function SalesPerformance() {
  const { company } = useAuth();

  if (!checkAccess(company?.plan_id, "hasAdvancedReporting")) {
    return <UpgradeWall featureName="Sales Performance" requiredPlan="Professional" />;
  }

  return <SalesPerformanceDashboard />;
}
