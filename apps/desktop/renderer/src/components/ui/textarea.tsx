import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({
  className,
  ref,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
