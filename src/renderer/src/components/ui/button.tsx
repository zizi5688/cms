import * as React from 'react'

import { cn } from '@renderer/lib/utils'

type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive'
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantClasses: Record<ButtonVariant, string> = {
  default: 'bg-zinc-50 text-zinc-950 hover:bg-zinc-200',
  outline: 'border border-zinc-700 bg-transparent text-zinc-50 hover:bg-zinc-900',
  ghost: 'bg-transparent text-zinc-50 hover:bg-zinc-900',
  destructive: 'bg-red-600 text-white hover:bg-red-500'
}

const sizeClasses: Record<ButtonSize, string> = {
  default: 'h-9 px-4',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-6',
  icon: 'h-9 w-9 p-0'
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:pointer-events-none disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
}

export { Button }
