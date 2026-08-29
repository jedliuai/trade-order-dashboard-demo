import { loadMasterProducts } from './masterDataService';

export interface ProductIdentityVariant {
  id: string;
  productId: string;
  specification: string;
  status: '启用' | '停用';
}

export interface ProductIdentityProduct {
  id: string;
  productCode: string;
  productName: string;
  englishName: string;
  aliases: string[];
  variants: ProductIdentityVariant[];
}

export interface ProductIdentityCatalog {
  products: ProductIdentityProduct[];
}

export async function loadProductIdentityCatalog(): Promise<ProductIdentityCatalog> {
  const products = await loadMasterProducts();

  return {
    products: products.map((product) => ({
      id: product.id,
      productCode: product.product_code,
      productName: product.chinese_name,
      englishName: product.english_name,
      aliases: product.aliases.map((alias) => alias.alias),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        productId: product.id,
        specification: variant.specification,
        status: variant.status
      }))
    }))
  };
}
