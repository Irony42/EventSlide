import { ButtonHTMLAttributes } from 'react'

interface PrimaryActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

export default function PrimaryActionButton({ label, className, ...props }: PrimaryActionButtonProps) {
  return (
    <button {...props} className={`btn btn-primary w-100 ${className ?? ''}`.trim()}>
      {label}
    </button>
  )
}
