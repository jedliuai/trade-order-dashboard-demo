export interface ContractVolumeContactSheetLike {
  id: string;
  quantity: number;
  shipped_quantity: number;
  unit?: string | null;
  pcs_per_carton?: number | null;
  packaging_profile_version_id?: string | null;
}

export interface ContractVolumePackagingVersionLike {
  id: string;
  quantity_per_carton?: number | null;
  quantity_unit?: string | null;
  carton_volume_m3?: number | null;
}

export interface ContractVolumeSummary {
  isComplete: boolean;
  missingSheetCount: number;
  totalVolumeM3: number;
  shippedVolumeM3: number;
  remainingVolumeM3: number;
}

function normalizeCartonUnit(value: string | null | undefined) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\/箱$/, '');
}

function roundVolume(value: number) {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * 合同页只提供概览估算：整张联系单先估算总体积，再按实际发货数量比例拆分。
 * 这样总体积、已发货体积和剩余体积始终可以互相核对。
 */
export function summarizeContractVolume(
  sheets: readonly ContractVolumeContactSheetLike[],
  packagingVersions: readonly ContractVolumePackagingVersionLike[]
): ContractVolumeSummary {
  if (sheets.length === 0) {
    return {
      isComplete: false,
      missingSheetCount: 0,
      totalVolumeM3: 0,
      shippedVolumeM3: 0,
      remainingVolumeM3: 0
    };
  }

  const versionById = new Map(packagingVersions.map((version) => [version.id, version]));
  let missingSheetCount = 0;
  let totalVolumeM3 = 0;
  let shippedVolumeM3 = 0;

  sheets.forEach((sheet) => {
    const version = sheet.packaging_profile_version_id
      ? versionById.get(sheet.packaging_profile_version_id)
      : undefined;
    const quantity = Number(sheet.quantity || 0);
    const quantityPerCarton = Number(sheet.pcs_per_carton || version?.quantity_per_carton || 0);
    const cartonVolumeM3 = Number(version?.carton_volume_m3 || 0);
    const sheetUnit = normalizeCartonUnit(sheet.unit);
    const packagingUnit = normalizeCartonUnit(version?.quantity_unit);
    const unitsMatch = !sheetUnit || !packagingUnit || sheetUnit === packagingUnit;

    if (!version || quantity <= 0 || quantityPerCarton <= 0 || cartonVolumeM3 <= 0 || !unitsMatch) {
      missingSheetCount += 1;
      return;
    }

    const sheetVolumeM3 = Math.ceil((quantity / quantityPerCarton) - 1e-10) * cartonVolumeM3;
    const shippedRatio = Math.min(1, Math.max(0, Number(sheet.shipped_quantity || 0) / quantity));
    totalVolumeM3 += sheetVolumeM3;
    shippedVolumeM3 += sheetVolumeM3 * shippedRatio;
  });

  if (missingSheetCount > 0) {
    return {
      isComplete: false,
      missingSheetCount,
      totalVolumeM3: 0,
      shippedVolumeM3: 0,
      remainingVolumeM3: 0
    };
  }

  totalVolumeM3 = roundVolume(totalVolumeM3);
  shippedVolumeM3 = roundVolume(shippedVolumeM3);
  return {
    isComplete: true,
    missingSheetCount: 0,
    totalVolumeM3,
    shippedVolumeM3,
    remainingVolumeM3: roundVolume(Math.max(0, totalVolumeM3 - shippedVolumeM3))
  };
}
