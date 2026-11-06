// Fixed, illustrative conversions for demo planning and virtual-credit accounting.
// They are deliberately independent from live display-currency quotations.
export const DEMO_CNY_RATES=Object.freeze({CNY:1,THB:0.2,USD:7,SGD:5});
export function normalizeBudget(value,guests,invalid){
 const hasRaw=Object.hasOwn(value,'budgetAmount');
 if(!hasRaw){
  const thb=value.budgetThb==null||value.budgetThb===''?null:value.budgetThb;
  if(thb!==null&&(!Number.isInteger(thb)||thb<1||thb>1000000))invalid();
  return {budgetThb:thb,...(thb===null?{}:{budgetCnyMinor:thb*20})};
 }
 const currency=value.budgetCurrency||'CNY',scope=value.budgetScope||'group',amount=value.budgetAmount;
 if(!Object.hasOwn(DEMO_CNY_RATES,currency)||!['person','group'].includes(scope))invalid();
 if(amount===null||amount==='')return {budgetAmount:null,budgetCurrency:currency,budgetScope:scope,budgetThb:null,budgetCnyMinor:null};
 if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0||amount>1000000||Math.abs(amount*100-Math.round(amount*100))>0.00001)invalid();
 const total=Math.round(amount*100*DEMO_CNY_RATES[currency]*(scope==='person'?guests:1));
 if(!Number.isSafeInteger(total)||total<20||total>20000000)invalid();
 return {budgetAmount:amount,budgetCurrency:currency,budgetScope:scope,budgetCnyMinor:total,budgetThb:Math.floor(total/20)};
}
