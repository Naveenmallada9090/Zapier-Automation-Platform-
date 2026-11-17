// Shown when the backend has no SMTP server configured. Without it the email
// would be printed to the server console and the user would be stuck.
export const DevEmailLink = ({ link, label }: {
    link?: string,
    label: string
}) => {
    if (!link) {
        return null;
    }

    return <div className="mt-4 p-3 border border-amber-500 bg-amber-50 rounded text-sm">
        <div className="font-semibold pb-1">Development mode</div>
        <div className="pb-2">
            No mail server is configured, so the email was not delivered. Use this link directly:
        </div>
        <a className="underline break-all" href={link}>{label}</a>
    </div>
}
