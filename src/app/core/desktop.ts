import { Injectable } from '@angular/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  IdentifierResult,
  ResetAcknowledgments,
  ResetReview,
  ResetSettingsPage,
  ScanResult,
} from './models';

@Injectable({ providedIn: 'root' })
export class Desktop {
  readonly available = isTauri();
  scan(selectedSerial: string | null): Promise<ScanResult> {
    return invoke<ScanResult>('scan_devices', { selectedSerial });
  }
  readIdentifiers(serial: string): Promise<IdentifierResult> {
    return invoke<IdentifierResult>('read_identifiers', { serial });
  }
  inspectReset(serial: string): Promise<ResetReview> {
    return invoke<ResetReview>('inspect_reset_device', { serial });
  }
  openResetAccounts(serial: string): Promise<ResetSettingsPage> {
    return invoke<ResetSettingsPage>('open_reset_accounts', { serial });
  }
  openResetSettings(
    serial: string,
    reviewId: string,
    acknowledgments: ResetAcknowledgments,
  ): Promise<ResetSettingsPage> {
    return invoke<ResetSettingsPage>('open_factory_reset_settings', {
      serial,
      reviewId,
      acknowledgments,
    });
  }
  copy(value: string): Promise<void> {
    if (this.available) return writeText(value);
    return navigator.clipboard.writeText(value);
  }
  notices(): Promise<string> {
    return invoke<string>('read_notices');
  }
}
