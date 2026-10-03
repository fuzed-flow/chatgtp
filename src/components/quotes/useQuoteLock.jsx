import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient"; // NEW: Supabase!

export function useQuoteLock(quoteId, currentUser) {
  const [lockStatus, setLockStatus] = useState({ 
    isLocked: false, 
    lockedBy: null, 
    canEdit: true 
  });
  const [myLockId, setMyLockId] = useState(null);

  // Check and acquire lock
  useEffect(() => {
    if (!quoteId || !currentUser) return;

    const checkAndAcquireLock = async () => {
      try {
        // Check for existing locks
        const { data: existingLocks, error: fetchError } = await supabase
          .from("quote_locks")
          .select("*")
          .eq("quote_id", quoteId);
          
        if (fetchError && fetchError.code !== '42P01') throw fetchError;

        // Remove stale locks (older than 5 minutes without heartbeat)
        const now = new Date();
        const activeLocks = [];
        
        for (const lock of (existingLocks || [])) {
          const lastHeartbeat = new Date(lock.last_heartbeat);
          const minutesSinceHeartbeat = (now - lastHeartbeat) / 1000 / 60;
          
          if (minutesSinceHeartbeat > 5) {
            await supabase.from("quote_locks").delete().eq("id", lock.id);
          } else {
            activeLocks.push(lock);
          }
        }

        if (activeLocks.length === 0) {
          // No active locks, acquire one
          const { data: newLock, error: insertError } = await supabase.from("quote_locks").insert([{
            company_id: currentUser.company_id || null,
            quote_id: quoteId,
            locked_by_user_id: currentUser.id,
            locked_by_user_name: currentUser.full_name || currentUser.email || "Unknown User",
            locked_at: new Date().toISOString(),
            last_heartbeat: new Date().toISOString(),
          }]).select().single();
          
          if (insertError) throw insertError;

          setMyLockId(newLock.id);
          setLockStatus({ isLocked: false, lockedBy: null, canEdit: true });
        } else {
          const lock = activeLocks[0];
          if (lock.locked_by_user_id === currentUser.id) {
            // I own this lock
            setMyLockId(lock.id);
            setLockStatus({ isLocked: false, lockedBy: null, canEdit: true });
          } else {
            // Someone else has it locked
            setLockStatus({ 
              isLocked: true, 
              lockedBy: lock.locked_by_user_name, 
              canEdit: false 
            });
          }
        }
      } catch (error) {
        console.error("Lock check failed:", error);
      }
    };

    checkAndAcquireLock();
  }, [quoteId, currentUser]);

  // Heartbeat to keep lock alive
  useEffect(() => {
    if (!myLockId) return;

    const heartbeat = setInterval(async () => {
      try {
        await supabase.from("quote_locks").update({
          last_heartbeat: new Date().toISOString(),
        }).eq("id", myLockId);
      } catch (error) {
        console.error("Heartbeat failed:", error);
      }
    }, 30000); // Every 30 seconds

    return () => clearInterval(heartbeat);
  }, [myLockId]);

  // Release lock on unmount
  useEffect(() => {
    return () => {
      if (myLockId) {
        supabase.from("quote_locks").delete().eq("id", myLockId).then(() => {}).catch(console.error);
      }
    };
  }, [myLockId]);

  return lockStatus;
}