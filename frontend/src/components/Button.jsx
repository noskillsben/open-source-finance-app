// The one button (DESIGN.md § Visual design → Components). Primary is filled accent and there is
// one per screen; secondary is outlined; quiet is text only; destructive is quiet text in
// `negative` and the caller asks once before doing anything. The classes live in index.css.
const VARIANTS = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  quiet: 'btn btn-quiet',
  destructive: 'btn btn-destructive',
}

export default function Button({ variant = 'primary', type = 'button', className = '', children, ...rest }) {
  return (
    <button type={type} className={`${VARIANTS[variant]} ${className}`.trim()} {...rest}>
      {children}
    </button>
  )
}
