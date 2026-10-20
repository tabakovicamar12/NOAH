import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  FileChartColumn,
  Folder,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  ClipboardList,
  Clock,
  CloudOff,
  Copy,
  EyeOff,
  FileText,
  Globe,
  House,
  Settings,
  ImageOff,
  LayoutGrid,
  List,
  Lock,
  LogOut,
  MapPin,
  Menu,
  Mic,
  Minus,
  Package,
  Pause,
  Pencil,
  Archive,
  UserPlus,
  KeyRound,
  UserCheck,
  UserX,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Square,
  StickyNote,
  Timer,
  Trash2,
  TriangleAlert,
  Undo2,
  Users,
  Wifi,
  X,
  type IconNode,
} from 'lucide';

const ICONS = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  calendar: CalendarDays,
  report: FileChartColumn,
  folder: Folder,
  camera: Camera,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle-check': CircleCheck,
  clipboard: ClipboardList,
  clock: Clock,
  'cloud-off': CloudOff,
  copy: Copy,
  'eye-off': EyeOff,
  file: FileText,
  globe: Globe,
  'image-off': ImageOff,
  grid: LayoutGrid,
  home: House,
  settings: Settings,
  list: List,
  lock: Lock,
  logout: LogOut,
  pin: MapPin,
  menu: Menu,
  mic: Mic,
  minus: Minus,
  package: Package,
  pause: Pause,
  pencil: Pencil,
  archive: Archive,
  'user-plus': UserPlus,
  key: KeyRound,
  'user-check': UserCheck,
  'user-x': UserX,
  play: Play,
  plus: Plus,
  printer: Printer,
  refresh: RefreshCw,
  retry: RotateCcw,
  search: Search,
  shield: ShieldCheck,
  stop: Square,
  note: StickyNote,
  timer: Timer,
  trash: Trash2,
  alert: TriangleAlert,
  undo: Undo2,
  users: Users,
  wifi: Wifi,
  x: X,
} as const satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/** Lucide icons rendered inline as SVG: one stroke family across the app, offline-safe, tree-shaken. */
@Component({
  selector: 'aon-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      [attr.width]="size()"
      [attr.height]="size()"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="square"
      stroke-linejoin="miter"
    >
      @for (node of nodes(); track $index) {
        @switch (node[0]) {
          @case ('path') {
            <svg:path [attr.d]="node[1]['d']" />
          }
          @case ('circle') {
            <svg:circle [attr.cx]="node[1]['cx']" [attr.cy]="node[1]['cy']" [attr.r]="node[1]['r']" />
          }
          @case ('rect') {
            <svg:rect
              [attr.x]="node[1]['x']"
              [attr.y]="node[1]['y']"
              [attr.width]="node[1]['width']"
              [attr.height]="node[1]['height']"
              [attr.rx]="node[1]['rx']"
            />
          }
          @case ('line') {
            <svg:line [attr.x1]="node[1]['x1']" [attr.y1]="node[1]['y1']" [attr.x2]="node[1]['x2']" [attr.y2]="node[1]['y2']" />
          }
          @case ('polyline') {
            <svg:polyline [attr.points]="node[1]['points']" />
          }
          @case ('polygon') {
            <svg:polygon [attr.points]="node[1]['points']" />
          }
        }
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number>(24);
  readonly stroke = input<number>(2.25);
  protected readonly nodes = computed(() => ICONS[this.name()] as unknown as ReadonlyArray<readonly [string, Readonly<Record<string, string | number | undefined>>]>);
}
