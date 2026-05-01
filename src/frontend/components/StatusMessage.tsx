interface StatusMessageProps {
  type: 'error' | 'success'
  message: string
}

export default function StatusMessage({ type, message }: StatusMessageProps) {
  return <p className={`status-message ${type} text-center`}>{message}</p>
}
