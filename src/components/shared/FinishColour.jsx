import React from 'react';
export default function FinishColour({ value }) {
  return value?.trim() ? <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-slate-700">Finish / Colour: {value}</p> : null;
}
