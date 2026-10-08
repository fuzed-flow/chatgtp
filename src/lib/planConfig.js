export const PLAN_LIMITS = {
  starter: {
    maxActiveProjects: 5,
    hasHR: false,
    hasChangeOrders: false,
    hasAdvancedReporting: false,
    hasAdvancedPermissions: false,
  },
  professional: {
    maxActiveProjects: Infinity,
    hasHR: true,
    hasChangeOrders: true,
    hasAdvancedReporting: true,
    hasAdvancedPermissions: false,
  },
  business: {
    maxActiveProjects: Infinity,
    hasHR: true,
    hasChangeOrders: true,
    hasAdvancedReporting: true,
    hasAdvancedPermissions: true,
  }
};

// Helper function to check access easily
export const checkAccess = (planId, feature) => {
  const normalizedPlanId = String(planId || '').trim().toLowerCase();
  const plan = PLAN_LIMITS[normalizedPlanId];
  return Boolean(plan?.[feature]);
};
