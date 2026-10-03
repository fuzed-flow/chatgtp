import React from "react";
import { MessageCircle, Mail, Phone, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function Contact() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-black text-slate-900">
          <MessageCircle className="h-8 w-8 text-amber-500" /> Contact Support
        </h1>
        <p className="mt-2 font-medium text-slate-500">Need a human? We're here to help you build better.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card className="space-y-4 border-slate-200 p-6 shadow-sm">
            <h3 className="border-b border-slate-100 pb-2 text-lg font-black text-slate-900">Send us a message</h3>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Subject</label>
                <Input placeholder="What do you need help with?" className="bg-slate-50 font-medium" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-500">Message Details</label>
                <Textarea rows={6} placeholder="Describe the issue you're facing..." className="bg-slate-50 font-medium" />
              </div>
              <Button className="bg-amber-500 font-black text-slate-900 shadow-md hover:bg-amber-600">
                Send Message
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-slate-200 bg-slate-50 p-5">
            <Mail className="mb-3 h-6 w-6 text-amber-500" />
            <h4 className="font-black text-slate-900">Call Us</h4>
            <p className="mt-1 text-sm font-medium text-slate-500">18554003000</p>
          </Card>
          <Card className="border-slate-200 bg-slate-50 p-5">
            <Clock className="mb-3 h-6 w-6 text-amber-500" />
            <h4 className="font-black text-slate-900">Business Hours</h4>
            <p className="mt-1 text-sm font-medium text-slate-500">Mon - Fri<br/>8:00 AM - 5:00 PM MT</p>
          </Card>
        </div>
      </div>
    </div>
  );
}