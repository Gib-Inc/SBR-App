import { ArrowLeft, FileText, Building, Scale, AlertTriangle, CheckCircle, Mail, CreditCard, Clock } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

export default function LegalEULA() {
  const effectiveDate = "January 24, 2026";
  const lastUpdated = "January 24, 2026";
  
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center px-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2" data-testid="link-back-home">
              <ArrowLeft className="h-4 w-4" />
              Back to App
            </Button>
          </Link>
          <div className="flex-1" />
          <div className="flex items-center gap-2" data-testid="text-legal-header">
            <FileText className="h-5 w-5" />
            <span className="font-semibold">Legal Documents</span>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-4xl px-4 py-8" data-testid="section-eula-main">
        <div className="space-y-6">
          <div className="text-center space-y-2" data-testid="section-eula-header">
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-eula-title">End User License Agreement</h1>
            <p className="text-muted-foreground" data-testid="text-effective-date">
              Effective Date: {effectiveDate} | Last Updated: {lastUpdated}
            </p>
            <div className="flex justify-center gap-2 pt-2" data-testid="badges-compliance">
              <Badge variant="outline" data-testid="badge-saas">SaaS Subscription</Badge>
              <Badge variant="outline" data-testid="badge-arizona">Arizona Law</Badge>
            </div>
          </div>

          <Card data-testid="card-eula-introduction">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                1. Introduction and Company Information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                This End User License Agreement ("Agreement" or "EULA") is a legally binding contract between you, the subscribing entity ("Subscriber," "you," or "your") and <strong>Walker AI</strong> ("Company," "we," "us," or "our"), a software development company organized and operating under the laws of the State of Arizona.
              </p>
              <p>
                Walker AI develops and provides software-as-a-service ("SaaS") solutions to businesses on a subscription basis. By accessing, subscribing to, or using our Manufacturing Inventory Management System software and related services (collectively, the "Software" or "Service"), you acknowledge that you have read, understood, and agree to be bound by this Agreement.
              </p>
              <p>
                <strong>IMPORTANT:</strong> If you do not agree to these terms, do not subscribe to or use the Software. This Agreement governs your subscription and use of the Software regardless of your business location.
              </p>
              <p>
                This Agreement is governed by and complies with the laws of the State of Arizona. For subscribers located in Utah, the Utah Consumer Privacy Act (UCPA) provisions also apply as set forth in our Privacy Policy.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-subscription">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                2. Subscription Terms
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <h4>2.1 Subscription Plans</h4>
              <p>
                The Software is offered on a subscription basis. Subscription plans, features, and pricing are as published on our website or as agreed upon in a separate order form or service agreement between you and Walker AI.
              </p>
              
              <h4>2.2 Billing and Payment</h4>
              <ul>
                <li>Subscription fees are billed in advance on a monthly or annual basis as selected at the time of subscription</li>
                <li>Payment is due upon invoice and must be made via the payment methods we accept</li>
                <li>All fees are non-refundable except as expressly stated in this Agreement or required by law</li>
                <li>We reserve the right to modify pricing with 30 days advance written notice</li>
                <li>Failure to pay may result in suspension or termination of your access to the Software</li>
              </ul>

              <h4>2.3 Subscription Renewal</h4>
              <p>
                Unless you cancel your subscription before the end of the current billing period, your subscription will automatically renew for successive periods of the same duration at the then-current subscription rate.
              </p>

              <h4>2.4 Cancellation</h4>
              <ul>
                <li>You may cancel your subscription at any time through your account settings or by contacting us</li>
                <li>Cancellation takes effect at the end of the current billing period</li>
                <li>Upon cancellation, you retain access to the Software until the end of your paid period</li>
                <li>We do not provide prorated refunds for partial billing periods unless required by law</li>
              </ul>

              <h4>2.5 Service Level</h4>
              <p>
                Walker AI strives to maintain 99.5% uptime availability for the Software. Scheduled maintenance windows will be communicated in advance when possible. We are not liable for downtime caused by factors outside our reasonable control.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-license">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                3. License Grant
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                Subject to the terms of this Agreement and your timely payment of subscription fees, Walker AI grants you a limited, non-exclusive, non-transferable, revocable license to access and use the Software during your subscription term for your internal business purposes.
              </p>
              <h4>3.1 Permitted Uses</h4>
              <ul>
                <li>Access and use the Software through authorized user accounts</li>
                <li>Input, store, and manage inventory, product, and order data</li>
                <li>Generate reports and analytics for your business operations</li>
                <li>Integrate with authorized third-party services (QuickBooks, Shopify, Amazon, etc.)</li>
                <li>Use AI-powered features for inventory forecasting and recommendations</li>
              </ul>
              <h4>3.2 Restrictions</h4>
              <p>You agree NOT to:</p>
              <ul>
                <li>Copy, modify, distribute, sell, or lease any part of the Software</li>
                <li>Reverse engineer, decompile, or disassemble the Software</li>
                <li>Attempt to gain unauthorized access to the Software or its related systems</li>
                <li>Use the Software for any unlawful purpose or in violation of any applicable laws</li>
                <li>Remove, alter, or obscure any proprietary notices on the Software</li>
                <li>Use the Software to process data for third parties without our written consent</li>
                <li>Sublicense, transfer, or assign your rights under this Agreement</li>
                <li>Exceed any usage limits specified in your subscription plan</li>
                <li>Use the Software in a way that could damage, disable, or impair the Service</li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-ip">
            <CardHeader>
              <CardTitle>4. Intellectual Property Rights</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                <strong>Ownership by Walker AI:</strong> The Software, including all source code, object code, algorithms, user interface designs, graphics, documentation, and all intellectual property rights therein, are and shall remain the sole and exclusive property of Walker AI. This Agreement does not grant you any ownership interest in the Software.
              </p>
              <p>
                The Software is protected by United States copyright laws, international treaty provisions, trade secret laws, and other applicable intellectual property laws. You acknowledge that the structure, organization, and code of the Software are valuable trade secrets of Walker AI.
              </p>
              <p>
                <strong>Your Data:</strong> You retain all rights to your data that you input into the Software ("Subscriber Data"). By using the Software, you grant Walker AI a limited, non-exclusive license to process your Subscriber Data solely for the purpose of providing the Software services to you.
              </p>
              <p>
                <strong>Feedback:</strong> If you provide suggestions, ideas, or feedback about the Software, Walker AI may use such feedback without obligation to you.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-integrations">
            <CardHeader>
              <CardTitle>5. Third-Party Integrations</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                The Software may integrate with third-party services including but not limited to:
              </p>
              <ul>
                <li><strong>Intuit QuickBooks</strong> - For accounting and financial data synchronization</li>
                <li><strong>Shopify</strong> - For e-commerce order management and inventory sync</li>
                <li><strong>Amazon Seller Central</strong> - For marketplace order management</li>
                <li><strong>GoHighLevel</strong> - For CRM and customer relationship management</li>
                <li><strong>Extensiv (formerly 3PL Central)</strong> - For warehouse management</li>
                <li><strong>OpenAI</strong> - For AI-powered analytics and recommendations</li>
                <li><strong>SendGrid</strong> - For email communications</li>
                <li><strong>Shippo</strong> - For shipping label generation</li>
                <li><strong>Google Ads / Facebook Ads</strong> - For advertising analytics</li>
              </ul>
              <p>
                Your use of these third-party services is governed by their respective terms of service and privacy policies. Walker AI is not responsible for the practices, availability, or performance of third-party services. You assume all risks associated with their use and are responsible for maintaining valid credentials for third-party integrations.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-warranties">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                6. Disclaimer of Warranties
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p className="font-semibold">
                THE SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
              </p>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, WALKER AI DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO:
              </p>
              <ul>
                <li>IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE</li>
                <li>WARRANTIES OF NON-INFRINGEMENT</li>
                <li>WARRANTIES THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE</li>
                <li>WARRANTIES REGARDING THE ACCURACY, RELIABILITY, OR COMPLETENESS OF ANY DATA OR CONTENT</li>
              </ul>
              <p>
                Walker AI does not warrant that the AI-powered features, forecasting, or recommendations will be accurate or suitable for your specific business needs. You acknowledge that AI predictions are estimates and should not be solely relied upon for critical business decisions.
              </p>
              <p>
                This disclaimer is made in accordance with Arizona Revised Statutes § 47-2316 regarding exclusion or modification of warranties.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-liability">
            <CardHeader>
              <CardTitle>7. Limitation of Liability</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:
              </p>
              <ul>
                <li>WALKER AI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, BUSINESS, OR GOODWILL.</li>
                <li>WALKER AI'S TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM OR RELATED TO THIS AGREEMENT SHALL NOT EXCEED THE TOTAL AMOUNT YOU PAID TO WALKER AI FOR THE SOFTWARE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.</li>
                <li>WALKER AI SHALL NOT BE LIABLE FOR ANY DAMAGES CAUSED BY YOUR FAILURE TO MAINTAIN ADEQUATE BACKUPS OF YOUR DATA.</li>
                <li>WALKER AI SHALL NOT BE LIABLE FOR ANY THIRD-PARTY SERVICE FAILURES OR DATA LOSS.</li>
              </ul>
              <p>
                Some jurisdictions do not allow the exclusion or limitation of certain damages. If these laws apply to you, some or all of the above limitations may not apply, and you may have additional rights.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-indemnification">
            <CardHeader>
              <CardTitle>8. Indemnification</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                You agree to indemnify, defend, and hold harmless Walker AI, its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising from or related to:
              </p>
              <ul>
                <li>Your use or misuse of the Software</li>
                <li>Your violation of this Agreement</li>
                <li>Your violation of any rights of any third party</li>
                <li>Your violation of any applicable laws or regulations</li>
                <li>Any Subscriber Data you input into the Software</li>
                <li>Your integration with third-party services</li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-termination">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                9. Term and Termination
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                <strong>Term:</strong> This Agreement is effective from the date you first subscribe to or use the Software and continues until terminated.
              </p>
              <p>
                <strong>Termination by You:</strong> You may terminate this Agreement at any time by canceling your subscription through your account settings or by contacting us. Termination takes effect at the end of your current billing period.
              </p>
              <p>
                <strong>Termination by Walker AI:</strong> We may terminate or suspend your access immediately, without prior notice, if:
              </p>
              <ul>
                <li>You breach any term of this Agreement</li>
                <li>You fail to pay subscription fees when due</li>
                <li>We are required to do so by law</li>
                <li>We cease offering the Software (with reasonable notice when possible)</li>
              </ul>
              <p>
                <strong>Effect of Termination:</strong>
              </p>
              <ul>
                <li>Your right to use the Software will immediately cease</li>
                <li>You may request export of your Subscriber Data within thirty (30) days of termination</li>
                <li>After 30 days, we may delete your Subscriber Data</li>
                <li>Sections relating to intellectual property, disclaimers, limitations of liability, and indemnification shall survive termination</li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-governing-law">
            <CardHeader>
              <CardTitle>10. Governing Law and Dispute Resolution</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                This Agreement shall be governed by and construed in accordance with the laws of the State of Arizona, without regard to its conflict of law provisions.
              </p>
              <p>
                Any disputes arising from this Agreement shall be resolved through the following process:
              </p>
              <ol>
                <li><strong>Informal Resolution:</strong> The parties shall first attempt to resolve disputes through good-faith negotiation for a period of thirty (30) days.</li>
                <li><strong>Mediation:</strong> If informal resolution fails, the parties agree to attempt mediation before pursuing other remedies.</li>
                <li><strong>Arbitration:</strong> Any unresolved disputes shall be submitted to binding arbitration in accordance with the rules of the American Arbitration Association, with venue in Maricopa County, Arizona.</li>
              </ol>
              <p>
                You agree that any claim or cause of action arising from or related to use of the Software must be filed within one (1) year after such claim or cause of action arose, or be forever barred.
              </p>
              <p>
                <strong>Class Action Waiver:</strong> You agree to resolve disputes with Walker AI on an individual basis and waive any right to participate in a class action lawsuit or class-wide arbitration.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-modifications">
            <CardHeader>
              <CardTitle>11. Modifications to Agreement</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                We reserve the right to modify this Agreement at any time. We will notify you of material changes by:
              </p>
              <ul>
                <li>Posting the updated Agreement with a new effective date</li>
                <li>Sending an email notification to the address associated with your account</li>
                <li>Displaying a notice within the Software</li>
              </ul>
              <p>
                Your continued use of the Software after such modifications constitutes acceptance of the updated Agreement. If you do not agree to the modified terms, you must cancel your subscription before the changes take effect.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-general">
            <CardHeader>
              <CardTitle>12. General Provisions</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p><strong>Entire Agreement:</strong> This Agreement, together with our Privacy Policy and any order forms or service agreements, constitutes the entire agreement between you and Walker AI regarding the Software and supersedes all prior agreements and understandings.</p>
              <p><strong>Severability:</strong> If any provision of this Agreement is found to be unenforceable, the remaining provisions shall continue in full force and effect.</p>
              <p><strong>Waiver:</strong> The failure of Walker AI to enforce any right or provision of this Agreement shall not constitute a waiver of such right or provision.</p>
              <p><strong>Assignment:</strong> You may not assign or transfer this Agreement without our prior written consent. Walker AI may assign this Agreement without restriction.</p>
              <p><strong>Force Majeure:</strong> Neither party shall be liable for any failure or delay in performance due to circumstances beyond its reasonable control, including natural disasters, acts of government, or third-party service outages.</p>
              <p><strong>Independent Contractor:</strong> Walker AI is an independent contractor and not an employee, agent, or partner of Subscriber.</p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-contact">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                13. Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                If you have any questions about this Agreement or the Software, please contact us at:
              </p>
              <div className="bg-muted p-4 rounded-lg">
                <p className="mb-1"><strong>Walker AI</strong></p>
                <p className="mb-1">Arizona, United States</p>
                <p className="mb-1">Legal Inquiries: legal@walkerai.dev</p>
                <p className="mb-1">Support: support@walkerai.dev</p>
                <p className="mb-1">Billing: billing@walkerai.dev</p>
              </div>
            </CardContent>
          </Card>

          <Separator />

          <div className="text-center text-sm text-muted-foreground space-y-2" data-testid="section-eula-footer">
            <p className="flex items-center justify-center gap-2" data-testid="text-compliance-notice">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              Compliant with Arizona State Law
            </p>
            <p data-testid="text-copyright">
              © {new Date().getFullYear()} Walker AI. All rights reserved.
            </p>
            <div className="flex justify-center gap-4 pt-2" data-testid="nav-legal-links">
              <Link href="/legal/privacy">
                <Button variant="ghost" size="sm" data-testid="link-privacy-policy">
                  Privacy Policy
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
