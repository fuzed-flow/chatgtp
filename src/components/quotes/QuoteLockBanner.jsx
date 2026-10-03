import React, { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient"; // NEW: Supabase!
import { Card } from "@/components/ui/card";
import { Lock } from "lucide-react";

export default function QuoteLockBanner({ quoteId, currentUser, onLockStatusChange }) {
  const [lockStatus, setLockStatus] = useState({ isLocked: false, lockedBy: null, canEdit: true });
  const [myLockId, setMyLockId] = useState(null);

  // Check and acquire lock
  useEffect(() => {
    if (!quoteId || !currentUser) return;

    const checkAndAcquireLock = async () => {
      try {
        // Fetch existing locks for this specific quote
        const { data: existingLocks, error: fetchError } = await supabase
          .from("quote_locks")
          .select("*")
          .eq("quote_id", quoteId);
          
        if (fetchError && fetchError.code !== '42P01') throw fetchError; // Ignore if table doesn't exist yet

        // Remove stale locks (older than 5 minutes)
        const now = new Date();
        const activeLocks = [];
        
        for (const lock of (existingLocks || [])) {
          const lastHeartbeat = new Date(lock.last_heartbeat);
          const minutesSinceHeartbeat = (now - lastHeartbeat) / 1000 / 60;
          
          if (minutesSinceHeartbeat > 5) {
            // Delete stale lock
            await supabase.from("quote_locks").delete().eq("id", lock.id);
          } else {
            activeLocks.push(lock);
          }
        }

        if (activeLocks.length === 0) {
          // Acquire new lock
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
          const status = { isLocked: false, lockedBy: null, canEdit: true };
          setLockStatus(status);
          onLockStatusChange?.(status);
          
        } else {
          const lock = activeLocks[0];
          if (lock.locked_by_user_id === currentUser.id) {
            // We already own the lock
            setMyLockId(lock.id);
            const status = { isLocked: false, lockedBy: null, canEdit: true };
            setLockStatus(status);
            onLockStatusChange?.(status);
          } else {
            // Someone else owns the lock
            const status = { isLocked: true, lockedBy: lock.locked_by_user_name, canEdit: false };
            setLockStatus(status);
            onLockStatusChange?.(status);
          }
        }
      } catch (error) {
        console.error("Lock check failed:", error);
      }
    };

    checkAndAcquireLock();
  }, [quoteId, currentUser, onLockStatusChange]);

  // Heartbeat every 30 seconds
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
    }, 30000);

    return () => clearInterval(heartbeat);
  }, [myLockId]);

  // Release lock on unmount
  useEffect(() => {
    return () => {
      if (myLockId) {
        // Fire-and-forget delete when leaving the page
        supabase.from("quote_locks").delete().eq("id", myLockId).then(() => {}).catch(console.error);
      }
    };
  }, [myLockId]);

  if (!lockStatus.isLocked) return null;

  return (
    <Card className="p-4 bg-red-50 border-2 border-red-400 mb-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-red-500 flex items-center justify-center text-white shrink-0">
          <Lock className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-red-900 text-sm sm:text-base">Quote is Currently Locked</h3>
          <p className="text-xs sm:text-sm text-red-700 mt-1">
            <strong>{lockStatus.lockedBy}</strong> is actively editing this quote. 
            You can view it in read-only mode to prevent overwriting their work.
          </p>
        </div>
      </div>
    </Card>
  );
}