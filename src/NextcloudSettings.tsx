import { ExternalLink, Link, RefreshCw } from "lucide-solid";
import { CourseSettingsMenu } from "./CourseSettingsMenu";

export function NextcloudSettings(props: { url: string; loading: boolean; onRefresh: () => void; onEdit: () => void; service?: string }) {
  const service = () => props.service || "Nextcloud";
  return (
    <CourseSettingsMenu label={`${service()} settings`}>
      {(close) => (
        <>
          <button
            type="button"
            role="menuitem"
            aria-label={`Refresh ${service()} files`}
            disabled={props.loading}
            onClick={() => {
              close();
              props.onRefresh();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh files</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label={`Edit ${service()} link`}
            onClick={() => {
              close(false);
              props.onEdit();
            }}
          >
            <Link size={16} aria-hidden="true" />
            <span>Edit link</span>
          </button>
          <a
            role="menuitem"
            href={props.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${service()} in browser`}
            onClick={() => close()}
          >
            <ExternalLink size={16} aria-hidden="true" />
            <span>Open in browser</span>
          </a>
        </>
      )}
    </CourseSettingsMenu>
  );
}
