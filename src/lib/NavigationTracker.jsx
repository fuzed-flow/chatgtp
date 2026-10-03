import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function NavigationTracker() {
  const location = useLocation();

  useEffect(() => {
    // We are temporarily disabling the old Base44 tracker.
    // You can add Firebase/Google Analytics tracking here later!
    console.log("Navigated to:", location.pathname);
    
    // OLD CRASHING CODE:
    // base44.analytics.logUserInApp(...) 
  }, [location]);

  return null; // This component doesn't render any UI
}