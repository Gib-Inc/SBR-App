import { ArrowLeft, FileText, Building, Scale, AlertTriangle, CheckCircle, Mail } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
          </div>

          <Card data-testid="card-eula-introduction">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Introduction and Company Information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                This End User License Agreement ("Agreement" or "EULA") is a legally binding contract between you ("User," "you," or "your") and <strong>Sticker Burr</strong> ("Company," "we," "us," or "our"), a company operating from Arizona with business operations in Hildale, Utah.
              </p>
              <p>
                By accessing, downloading, installing, or using our Manufacturing Inventory Management System software and related services (collectively, the "Software"), you acknowledge that you have read, understood, and agree to be bound by this Agreement. If you do not agree to these terms, do not use the Software.
              </p>
              <p>
                This Agreement is governed by and complies with the laws of the State of Arizona and the State of Utah, including but not limited to the Utah Uniform Commercial Code (UCC), Arizona Revised Statutes, and applicable federal laws.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-license">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                License Grant
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                Subject to the terms of this Agreement, the Company grants you a limited, non-exclusive, non-transferable, revocable license to use the Software for your internal business purposes in connection with inventory management, order processing, and related business operations.
              </p>
              <h4>2.1 Permitted Uses</h4>
              <ul>
                <li>Access and use the Software through authorized accounts</li>
                <li>Input, store, and manage inventory, product, and order data</li>
                <li>Generate reports and analytics for your business operations</li>
                <li>Integrate with authorized third-party services (QuickBooks, Shopify, Amazon, etc.)</li>
                <li>Use AI-powered features for inventory forecasting and recommendations</li>
              </ul>
              <h4>2.2 Restrictions</h4>
              <p>You agree NOT to:</p>
              <ul>
                <li>Copy, modify, distribute, sell, or lease any part of the Software</li>
                <li>Reverse engineer, decompile, or disassemble the Software</li>
                <li>Attempt to gain unauthorized access to the Software or its related systems</li>
                <li>Use the Software for any unlawful purpose or in violation of any applicable laws</li>
                <li>Remove, alter, or obscure any proprietary notices on the Software</li>
                <li>Use the Software to process data for third parties without our written consent</li>
                <li>Sublicense, transfer, or assign your rights under this Agreement</li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-ip">
            <CardHeader>
              <CardTitle>3. Intellectual Property Rights</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                The Software and all copies thereof are proprietary to the Company and title thereto remains exclusively with the Company. All rights in the Software not specifically granted in this Agreement are reserved to the Company.
              </p>
              <p>
                The Software is protected by United States copyright laws, international treaty provisions, and other applicable laws. You acknowledge that the structure, organization, and code of the Software are valuable trade secrets of the Company.
              </p>
              <p>
                You retain all rights to your data that you input into the Software. By using the Software, you grant us a limited license to process your data solely for the purpose of providing the Software services to you.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-integrations">
            <CardHeader>
              <CardTitle>4. Third-Party Integrations</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                The Software may integrate with third-party services including but not limited to:
              </p>
              <ul>
                <li><strong>QuickBooks</strong> - For accounting and financial data synchronization</li>
                <li><strong>Shopify</strong> - For e-commerce order management and inventory sync</li>
                <li><strong>Amazon</strong> - For marketplace order management</li>
                <li><strong>GoHighLevel</strong> - For CRM and customer relationship management</li>
                <li><strong>Extensiv (formerly 3PL Central)</strong> - For warehouse management</li>
                <li><strong>OpenAI</strong> - For AI-powered analytics and recommendations</li>
                <li><strong>SendGrid</strong> - For email communications</li>
                <li><strong>Shippo</strong> - For shipping label generation</li>
              </ul>
              <p>
                Your use of these third-party services is governed by their respective terms of service and privacy policies. We are not responsible for the practices of third-party services, and you assume all risks associated with their use.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-warranties">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                5. Disclaimer of Warranties
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p className="font-semibold">
                THE SOFTWARE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
              </p>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE COMPANY DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO:
              </p>
              <ul>
                <li>IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE</li>
                <li>WARRANTIES OF NON-INFRINGEMENT</li>
                <li>WARRANTIES THAT THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE</li>
                <li>WARRANTIES REGARDING THE ACCURACY, RELIABILITY, OR COMPLETENESS OF ANY DATA OR CONTENT</li>
              </ul>
              <p>
                The Company does not warrant that the AI-powered features, forecasting, or recommendations will be accurate or suitable for your specific business needs. You acknowledge that AI predictions are estimates and should not be solely relied upon for critical business decisions.
              </p>
              <p>
                This disclaimer is made in accordance with Arizona Revised Statutes § 47-2316 and Utah Code § 70A-2-316 regarding exclusion or modification of warranties.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-liability">
            <CardHeader>
              <CardTitle>6. Limitation of Liability</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:
              </p>
              <ul>
                <li>THE COMPANY SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, BUSINESS, OR GOODWILL.</li>
                <li>THE COMPANY'S TOTAL LIABILITY FOR ANY CLAIMS ARISING FROM OR RELATED TO THIS AGREEMENT SHALL NOT EXCEED THE AMOUNT YOU PAID FOR THE SOFTWARE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.</li>
                <li>THE COMPANY SHALL NOT BE LIABLE FOR ANY DAMAGES CAUSED BY YOUR FAILURE TO MAINTAIN ADEQUATE BACKUPS OF YOUR DATA.</li>
              </ul>
              <p>
                Some jurisdictions do not allow the exclusion or limitation of certain damages. If these laws apply to you, some or all of the above limitations may not apply, and you may have additional rights.
              </p>
              <p>
                This limitation is consistent with Arizona Revised Statutes and Utah Commercial Code provisions regarding limitation of remedies.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-indemnification">
            <CardHeader>
              <CardTitle>7. Indemnification</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                You agree to indemnify, defend, and hold harmless the Company, its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising from or related to:
              </p>
              <ul>
                <li>Your use or misuse of the Software</li>
                <li>Your violation of this Agreement</li>
                <li>Your violation of any rights of any third party</li>
                <li>Your violation of any applicable laws or regulations</li>
                <li>Any data or content you input into the Software</li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-termination">
            <CardHeader>
              <CardTitle>8. Term and Termination</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                This Agreement is effective until terminated. We may terminate or suspend your access to the Software immediately, without prior notice or liability, for any reason, including if you breach any term of this Agreement.
              </p>
              <p>
                Upon termination:
              </p>
              <ul>
                <li>Your right to use the Software will immediately cease</li>
                <li>You must destroy all copies of the Software in your possession</li>
                <li>You may request export of your data within thirty (30) days of termination</li>
                <li>Sections relating to intellectual property, disclaimers, limitations of liability, and indemnification shall survive termination</li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-governing-law">
            <CardHeader>
              <CardTitle>9. Governing Law and Dispute Resolution</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                This Agreement shall be governed by and construed in accordance with the laws of the State of Arizona, without regard to its conflict of law provisions. For matters relating to business operations in Utah, Utah state law may apply as appropriate.
              </p>
              <p>
                Any disputes arising from this Agreement shall be resolved through the following process:
              </p>
              <ol>
                <li><strong>Informal Resolution:</strong> The parties shall first attempt to resolve disputes through good-faith negotiation.</li>
                <li><strong>Mediation:</strong> If informal resolution fails, the parties agree to attempt mediation before pursuing other remedies.</li>
                <li><strong>Arbitration:</strong> Any unresolved disputes shall be submitted to binding arbitration in accordance with the rules of the American Arbitration Association, with venue in Arizona.</li>
              </ol>
              <p>
                You agree that any claim or cause of action arising from or related to use of the Software must be filed within one (1) year after such claim or cause of action arose, or be forever barred.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-modifications">
            <CardHeader>
              <CardTitle>10. Modifications to Agreement</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                We reserve the right to modify this Agreement at any time. We will notify you of material changes by posting the updated Agreement with a new effective date. Your continued use of the Software after such modifications constitutes acceptance of the updated Agreement.
              </p>
              <p>
                It is your responsibility to review this Agreement periodically for changes.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-general">
            <CardHeader>
              <CardTitle>11. General Provisions</CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p><strong>Entire Agreement:</strong> This Agreement constitutes the entire agreement between you and the Company regarding the Software and supersedes all prior agreements and understandings.</p>
              <p><strong>Severability:</strong> If any provision of this Agreement is found to be unenforceable, the remaining provisions shall continue in full force and effect.</p>
              <p><strong>Waiver:</strong> The failure of the Company to enforce any right or provision of this Agreement shall not constitute a waiver of such right or provision.</p>
              <p><strong>Assignment:</strong> You may not assign or transfer this Agreement without our prior written consent. We may assign this Agreement without restriction.</p>
              <p><strong>Force Majeure:</strong> Neither party shall be liable for any failure or delay in performance due to circumstances beyond its reasonable control.</p>
            </CardContent>
          </Card>

          <Card data-testid="card-eula-contact">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                12. Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
              <p>
                If you have any questions about this Agreement, please contact us at:
              </p>
              <div className="bg-muted p-4 rounded-lg">
                <p className="mb-1"><strong>Sticker Burr</strong></p>
                <p className="mb-1">Hildale, Utah</p>
                <p className="mb-1">Email: legal@stickerburr.com</p>
              </div>
            </CardContent>
          </Card>

          <Separator />

          <div className="text-center text-sm text-muted-foreground space-y-2" data-testid="section-eula-footer">
            <p className="flex items-center justify-center gap-2" data-testid="text-compliance-notice">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              Compliant with Utah and Arizona State Laws
            </p>
            <p data-testid="text-copyright">
              © {new Date().getFullYear()} Sticker Burr. All rights reserved.
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
