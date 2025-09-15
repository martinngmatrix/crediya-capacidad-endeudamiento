import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({ region: "us-east-1" });
const RESPONSE_QUEUE_URL = process.env.RESPONSE_QUEUE_URL;

export const handler = async (event) => {
  for (const record of event.Records) {
    const body = JSON.parse(record.body);
    console.log("Processing record:", body);
    const {
      loanApplicationId,
      email,
      totalIncome,
      approvedLoans,
      newLoan
    } = body.payload;

    const maxCapacity = totalIncome * 0.35;

    const currentMonthlyDebt = Array.isArray(approvedLoans)
      ? approvedLoans.reduce((acc, loan) => {
          return acc + calculateInstallment(
            loan.amount,
            loan.interestRate,
            loan.term
          );
        }, 0)
      : 0;

    const availableCapacity = maxCapacity - currentMonthlyDebt;

    const newLoanInstallment = calculateInstallment(
      newLoan.amount,
      newLoan.interestRate,
      newLoan.term
    );

    let result = "Rechazado";
    if (newLoanInstallment <= availableCapacity) {
      if (newLoan.amount > totalIncome * 5) {
        result = "Revision Manual";
      } else {
        result = "Aprobado";
      }
    }

    const paymentPlan = generatePaymentPlan(
      newLoan.amount,
      newLoan.interestRate,
      newLoan.term
    );

    const finalResult = {
      result,
      loanApplicationId,
      email,
      maxCapacity,
      currentMonthlyDebt,
      availableCapacity,
      newLoanInstallment,
      paymentPlan
    };

    console.log("Result:", finalResult);

    await sqs.send(
      new SendMessageCommand({
        QueueUrl: RESPONSE_QUEUE_URL,
        MessageBody: JSON.stringify(finalResult),
      })
    );
  }

  return { statusCode: 200 };
};

function calculateInstallment(amount, interestRate, term) {
  const P = Number(amount);
  const i = Number(interestRate) / 100;
  const n = Number(term);

  if (!P || !n) return 0;
  if (i === 0) return P / n;

  return (P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
}

function generatePaymentPlan(amount, interestRate, term) {
  const P = Number(amount);
  const i = Number(interestRate) / 100;
  const n = Number(term);

  if (!P || !n) return [];

  const installment = calculateInstallment(P, interestRate, n);
  let balance = P;

  const plan = [];

  for (let month = 1; month <= n; month++) {
    const interest = balance * i;
    const capital = installment - interest;
    balance = balance - capital;

    plan.push({
      month,
      installment: Number(installment.toFixed(2)),
      capital: Number(capital.toFixed(2)),
      interest: Number(interest.toFixed(2)),
      remainingBalance: Number(balance > 0 ? balance.toFixed(2) : 0)
    });
  }

  return plan;
}