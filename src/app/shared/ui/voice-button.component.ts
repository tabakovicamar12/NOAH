import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/sl';
import { NetworkStatusService } from '../../core/network/network-status.service';
import { PrivacyPrefsService } from '../../core/privacy/privacy-prefs.service';
import { SpeechService, type SpeechFailure } from '../../core/privacy/speech.service';
import { ToastService } from '../../core/ui/toast.service';
import { IconComponent } from './icon.component';
import { NoticeSheetComponent, type NoticePoint } from './notice-sheet.component';

const FAILURE_TEXT: Readonly<Record<SpeechFailure, TranslationKey>> = {
  UNSUPPORTED: 'voice.unsupported',
  DENIED: 'voice.denied',
  NO_SPEECH: 'voice.noSpeech',
  NETWORK: 'voice.offline',
  FAILED: 'voice.failed',
};

/**
 * 🎤 GOVORI: dictation into the neighbouring text field. Asks for consent before the first use (the browser
 * vendor processes the audio), then the browser asks for the microphone. Each finished phrase is emitted.
 */
@Component({
  selector: 'aon-voice-button',
  imports: [IconComponent, NoticeSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (mine() && speech.listening()) {
      <button
        type="button"
        class="w-btn w-btn-dark"
        (click)="stop()"
      >
        <span class="relative grid size-4 place-items-center" aria-hidden="true">
          <span class="absolute inset-0 animate-ping rounded-full bg-white/60"></span>
          <span class="size-2.5 rounded-full bg-white"></span>
        </span>
        {{ i18n.t('voice.stop') }}
      </button>
      <p class="w-muted w-small mt-1.5 min-h-6" aria-live="polite">
        {{ speech.interim() || i18n.t('voice.listening') }}
      </p>
    } @else {
      <button
        type="button"
        class="w-btn w-btn-line"
        [disabled]="!speech.supported || !network.online() || (speech.listening() && !mine())"
        [attr.aria-describedby]="hintId"
        (click)="start()"
      >
        <aon-icon name="mic" [size]="18" [stroke]="2" />{{ i18n.t('order.speak') }}
      </button>
      @if (unavailable(); as reason) {
        <p [id]="hintId" class="w-muted w-small mt-1.5">{{ i18n.t(reason) }}</p>
      }
    }

    @if (asking()) {
      <aon-notice-sheet
        [heading]="i18n.t('voice.consentTitle')"
        icon="mic"
        [points]="consentPoints()"
        [acceptLabel]="i18n.t('voice.consentAccept')"
        [declineLabel]="i18n.t('voice.consentDecline')"
        (accepted)="consentGiven()"
        (declined)="asking.set(false)"
      />
    }
  `,
})
export class VoiceButtonComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly speech = inject(SpeechService);
  protected readonly network = inject(NetworkStatusService);
  private readonly prefs = inject(PrivacyPrefsService);
  private readonly toast = inject(ToastService);

  readonly compact = input(false);
  readonly text = output<string>();

  private static nextId = 0;
  protected readonly hintId = `aon-voice-hint-${VoiceButtonComponent.nextId++}`;
  protected readonly asking = signal(false);
  /** Whether the running session belongs to this button (several fields can have one). */
  protected readonly mine = signal(false);

  protected readonly unavailable = computed<TranslationKey | null>(() =>
    !this.speech.supported ? 'voice.unsupported' : !this.network.online() ? 'voice.offline' : null,
  );

  protected readonly consentPoints = computed<readonly NoticePoint[]>(() => [
    { icon: 'mic', text: this.i18n.t('voice.consentP1') },
    { icon: 'globe', text: this.i18n.t('voice.consentP2') },
    { icon: 'shield', text: this.i18n.t('voice.consentP3') },
    { icon: 'x', text: this.i18n.t('voice.consentP4') },
  ]);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.mine()) this.speech.stop();
    });
  }

  protected start(): void {
    if (!this.prefs.hasVoiceConsent()) {
      this.asking.set(true);
      return;
    }
    this.listen();
  }

  protected stop(): void {
    this.speech.stop();
  }

  /** Runs inside the consent button's click, so the microphone prompt follows the user's own tap. */
  protected consentGiven(): void {
    this.asking.set(false);
    void this.prefs.grantVoice();
    this.listen();
  }

  private listen(): void {
    this.mine.set(true);
    this.speech
      .listen((phrase) => this.text.emit(phrase))
      .catch((failure: unknown) => {
        const key = FAILURE_TEXT[failure as SpeechFailure] ?? 'voice.failed';
        this.toast.error(this.i18n.t(key));
      })
      .finally(() => this.mine.set(false));
  }
}
