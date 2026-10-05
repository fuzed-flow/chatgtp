import * as React from "react"

import AIRewriteTextarea from "@/components/shared/AIRewriteTextarea"
import { PlainTextarea } from "@/components/ui/textarea-base"
import { shouldUseWritingTools } from "@/lib/aiRewrite"

const Textarea = React.forwardRef(({ writingTools, rewriteField = "general_business_text", ...props }, ref) => {
  if (shouldUseWritingTools({ writingTools, ...props })) {
    return <AIRewriteTextarea {...props} ref={ref} rewriteField={rewriteField} />;
  }
  return <PlainTextarea {...props} ref={ref} />;
})
Textarea.displayName = "Textarea"

export { PlainTextarea, Textarea }
